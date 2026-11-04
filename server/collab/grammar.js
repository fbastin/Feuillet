// server/collab/grammar.js
// Grammar and style checking, as Overleaf's Writefull: a paragraph of a
// document goes to LanguageTool, which runs on this machine, on a network of
// its own without Internet (deploy/docker-compose.yml), and what it finds
// comes back. Spelling is left to Feuillet's own checker. For signed-in
// accounts only, bounded; nothing is kept or logged, not even the text's
// length.
//
// The paragraph comes as LanguageTool's annotated text: its prose as text,
// the rest (commands, formulas...) as markup with what it reads as, so that
// the places found are the paragraph's own (src/utils/grammarText.ts).
//
//   GET  /grammar        -> {enabled}
//   POST /grammar/check  {language, annotation, disabledRules?} (token)
//                        -> {matches: [{offset, length, message,
//                           replacements, rule: {id, category, issueType}}]}
//
// Environment (read by server.js):
//   GRAMMAR_URL   LanguageTool's address, e.g. http://languagetool:8010;
//                 unset turns grammar checking off

const MAX_BODY_BYTES = 256 * 1024;
const MAX_CHARS = 20000;
const MAX_PARTS = 4000;
const MAX_DISABLED_RULES = 100;
const WINDOW_MS = 60 * 1000;
const MAX_PER_ACCOUNT = 120;
const MAX_CONCURRENT = 4;
// LanguageTool makes a language's rules at its first check, which takes
// seconds, more in a container just started.
const TIMEOUT_MS = 45 * 1000;
// So that nobody waits for that: French and English, once it is up.
const WARM_LANGUAGES = ['fr', 'en-US'];
const WARM_DELAY_MS = 10 * 1000;
const WARM_ATTEMPTS = 20;
const LANGUAGE = /^(?:auto|[a-z]{2,3}(?:-[A-Z]{2})?)$/;
const RULE = /^[A-Za-z0-9_]{1,100}$/;
// What the source of LaTeX or Typst makes look wrong: several spaces, which
// print as one, and the spaces before « : ; ! ? », which babel adds.
const ALWAYS_DISABLED = ['WHITESPACE_RULE', 'CONSECUTIVE_SPACES', 'FRENCH_WHITESPACE'];
// Spelling, which Feuillet's own checker does with the user's dictionary.
const SPELLING_RULE = /MORFOLOGIK|HUNSPELL|SPELLING_RULE|SPELLER/;

class GrammarError extends Error {
	constructor(status, code) {
		super(code);
		this.status = status;
		this.code = code;
	}
}

// The annotated text as LanguageTool takes it, checked and bounded.
const cleanAnnotation = (annotation) => {
	if (!Array.isArray(annotation) || annotation.length === 0) {
		throw new GrammarError(400, 'invalid_annotation');
	}
	if (annotation.length > MAX_PARTS) throw new GrammarError(413, 'too_long');
	let chars = 0;
	const parts = annotation.map((part) => {
		if (part && typeof part.text === 'string' && part.markup === undefined) {
			chars += part.text.length;
			return { text: part.text };
		}
		if (part && typeof part.markup === 'string' && part.text === undefined) {
			const interpretAs =
				typeof part.interpretAs === 'string' ? part.interpretAs.slice(0, 100) : '';
			chars += part.markup.length;
			return { markup: part.markup, interpretAs };
		}
		throw new GrammarError(400, 'invalid_annotation');
	});
	if (chars > MAX_CHARS) throw new GrammarError(413, 'too_long');
	return parts;
};

const cleanMatch = (match) => ({
	offset: Number(match.offset),
	length: Number(match.length),
	message: String(match.message ?? '').slice(0, 500),
	shortMessage: String(match.shortMessage ?? '').slice(0, 100),
	replacements: (Array.isArray(match.replacements) ? match.replacements : [])
		.slice(0, 5)
		.map((replacement) => String(replacement?.value ?? '').slice(0, 100)),
	rule: {
		id: String(match.rule?.id ?? ''),
		category: String(match.rule?.category?.id ?? ''),
		issueType: String(match.rule?.issueType ?? ''),
	},
});

const createGrammar = ({ accounts, url, log = () => {} }) => {
	const base = (url || '').replace(/\/+$/, '');
	const recent = new Map();
	let active = 0;

	// Makes the rules of the languages most used before anyone checks.
	const warm = async (attempt = 1) => {
		try {
			for (const language of WARM_LANGUAGES) {
				const response = await fetch(`${base}/v2/check`, {
					method: 'POST',
					body: new URLSearchParams({ text: 'Bonjour.', language }),
					signal: AbortSignal.timeout(TIMEOUT_MS * 2),
				});
				if (!response.ok) throw new Error(`status ${response.status}`);
				await response.text();
			}
			log('grammar checking ready');
		} catch {
			if (attempt < WARM_ATTEMPTS) {
				setTimeout(() => void warm(attempt + 1), WARM_DELAY_MS).unref();
			}
		}
	};
	if (base) setTimeout(() => void warm(), WARM_DELAY_MS).unref();

	setInterval(() => {
		const now = Date.now();
		for (const [account, times] of recent) {
			if (times.every((time) => now - time >= WINDOW_MS)) recent.delete(account);
		}
	}, WINDOW_MS).unref();

	const limit = (account) => {
		const now = Date.now();
		const times = (recent.get(account) ?? []).filter((time) => now - time < WINDOW_MS);
		if (times.length >= MAX_PER_ACCOUNT) throw new GrammarError(429, 'too_many_checks');
		times.push(now);
		recent.set(account, times);
	};

	const readBody = (req) =>
		new Promise((resolve, reject) => {
			const chunks = [];
			let size = 0;
			req.on('data', (chunk) => {
				size += chunk.length;
				if (size > MAX_BODY_BYTES) {
					reject(new GrammarError(413, 'too_long'));
					req.destroy();
					return;
				}
				chunks.push(chunk);
			});
			req.on('end', () => {
				try {
					resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
				} catch {
					reject(new GrammarError(400, 'invalid_json'));
				}
			});
			req.on('error', () => reject(new GrammarError(400, 'interrupted')));
		});

	const reply = (res, status, body) => {
		res.writeHead(status, {
			'Content-Type': 'application/json',
			'Cache-Control': 'no-store',
		});
		res.end(JSON.stringify(body));
	};

	const check = async (body) => {
		const language = typeof body?.language === 'string' ? body.language : '';
		if (!LANGUAGE.test(language)) throw new GrammarError(400, 'invalid_language');
		const annotation = cleanAnnotation(body.annotation);
		const asked = Array.isArray(body.disabledRules) ? body.disabledRules : [];
		if (asked.length > MAX_DISABLED_RULES) throw new GrammarError(400, 'invalid_rules');
		const disabled = new Set(ALWAYS_DISABLED);
		for (const rule of asked) {
			if (typeof rule !== 'string' || !RULE.test(rule)) {
				throw new GrammarError(400, 'invalid_rules');
			}
			disabled.add(rule);
		}
		if (active >= MAX_CONCURRENT) throw new GrammarError(503, 'busy');
		active++;
		try {
			const response = await fetch(`${base}/v2/check`, {
				method: 'POST',
				body: new URLSearchParams({
					data: JSON.stringify({ annotation }),
					language,
					disabledRules: [...disabled].join(','),
				}),
				signal: AbortSignal.timeout(TIMEOUT_MS),
			});
			if (!response.ok) throw new GrammarError(502, 'grammar_failed');
			const result = await response.json();
			return (Array.isArray(result?.matches) ? result.matches : [])
				.filter((match) => !SPELLING_RULE.test(String(match?.rule?.id ?? '')))
				.map(cleanMatch)
				.filter(
					(match) =>
						Number.isInteger(match.offset) &&
						Number.isInteger(match.length) &&
						match.offset >= 0 &&
						match.length > 0,
				);
		} catch (error) {
			if (error instanceof GrammarError) throw error;
			throw new GrammarError(502, 'grammar_failed');
		} finally {
			active--;
		}
	};

	const handles = (path) => path === '/grammar' || path === '/grammar/check';

	const handle = async (req, res, path) => {
		try {
			if (path === '/grammar') {
				req.resume();
				reply(res, 200, { enabled: Boolean(base) });
				return;
			}
			if (req.method !== 'POST') {
				req.resume();
				res.setHeader('Allow', 'POST, OPTIONS');
				reply(res, 405, { error: 'method_not_allowed' });
				return;
			}
			if (!base) throw new GrammarError(404, 'grammar_disabled');
			const account = await accounts.identify(req);
			limit(account);
			const matches = await check(await readBody(req));
			reply(res, 200, { matches });
		} catch (error) {
			req.resume();
			// Never the text, nor what LanguageTool said of it.
			reply(res, Number.isInteger(error?.status) ? error.status : 500, {
				error: typeof error?.code === 'string' ? error.code : 'server_error',
			});
		}
	};

	return { handles, handle };
};

module.exports = { createGrammar, cleanAnnotation, ALWAYS_DISABLED };
