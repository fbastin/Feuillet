// src/extensions/codemirror/GrammarExtension.ts
// Grammar and style checking, as Overleaf's Writefull: once typing pauses,
// the paragraphs in view go to LanguageTool on Feuillet's server
// (server/collab/grammar.js), as annotated text whose commands, formulas and
// references are markup (utils/grammarText.ts); what it finds is underlined
// in blue, spelling staying red, and hovering it offers the corrections, to
// ignore it here, or to turn its rule off.
import {
	type EditorState,
	type Extension,
	StateEffect,
	StateField,
} from '@codemirror/state';
import {
	Decoration,
	type DecorationSet,
	EditorView,
	hoverTooltip,
	ViewPlugin,
	type ViewUpdate,
} from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';

import { t } from '@/i18n';
import { createNamedLogger } from '@/logging';
import {
	AccountServerError,
	type GrammarMatch,
	accountSyncService,
} from '../../services/AccountSyncService';
import { filePathCacheService } from '../../services/FilePathCacheService';
import { fileStoreService } from '../../services/FileStoreService';
import type { SpellingLanguage, SpellingSetting } from '../../types/spelling';
import {
	GRAMMAR_RULES_CHANGED,
	disableGrammarRule,
	disabledGrammarRules,
} from '../../utils/grammarRules';
import {
	type GrammarFormat,
	type TextRange,
	annotate,
	hasWords,
	paragraphsAround,
} from '../../utils/grammarText';
import {
	declaredLanguage,
	declaredTypstLanguage,
	grammarLanguageOf,
	guessLanguage,
	interfaceSpellingLanguage,
	isProse,
	typstProseRuns,
} from '../../utils/spellingUtils';
import { getAnnotationMaskRanges } from './annotations/annotationMasking';

const moduleLog = createNamedLogger('GrammarExtension');

const SCAN_DELAY_MS = 1500;
const MAX_IN_FLIGHT = 2;
const BACKOFF_MS = 30_000;
const RETRY_MS = 15_000;
const MAX_CACHED = 400;
// Babel, polyglossia and #set text(lang: ...) come early.
const PREAMBLE_LENGTH = 20_000;

export interface GrammarOptions {
	format: GrammarFormat;
	userId: string;
	interfaceLanguage: string;
	/** The spelling setting: a language it names is the document's too. */
	spellingSetting: SpellingSetting;
}

interface GrammarIssue extends TextRange {
	match: GrammarMatch;
}

interface GrammarScan extends TextRange {
	issues: GrammarIssue[];
}

const setIssues = StateEffect.define<GrammarScan[]>();
const dropIssues = StateEffect.define<{ rule?: string; at?: TextRange }>();

const issueMark = (match: GrammarMatch) =>
	Decoration.mark({
		class: 'cm-grammar-issue',
		attributes: { 'data-rule': match.rule.id },
		match,
	});

const issuesField = StateField.define<DecorationSet>({
	create: () => Decoration.none,

	update(marks, tr) {
		let next = marks.map(tr.changes);
		// An edit within a mistake takes its mark away until checked again.
		tr.changes.iterChanges((_fromA, _toA, fromB, toB) => {
			next = next.update({
				filterFrom: fromB,
				filterTo: toB,
				filter: (from, to) => to < fromB || from > toB,
			});
		});
		for (const effect of tr.effects) {
			if (effect.is(setIssues)) {
				for (const scan of effect.value) {
					next = next.update({
						filterFrom: scan.from,
						filterTo: scan.to,
						filter: (from, to) => from < scan.from || to > scan.to,
						add: scan.issues.map(({ from, to, match }) =>
							issueMark(match).range(from, to),
						),
						sort: true,
					});
				}
			} else if (effect.is(dropIssues)) {
				const { rule, at } = effect.value;
				next = next.update({
					filter: (from, to, value) =>
						!(
							(rule && value.spec.match?.rule.id === rule) ||
							(at && from === at.from && to === at.to)
						),
				});
			}
		}
		return next;
	},

	provide: (field) => EditorView.decorations.from(field),
});

// The places of the prose of `[from, to)`, comment and review tags left out.
function proseRanges(
	state: EditorState,
	from: number,
	to: number,
	format: GrammarFormat,
): TextRange[] {
	const ranges: TextRange[] = [];
	const clip = (start: number, end: number) => {
		const a = Math.max(start, from);
		const b = Math.min(end, to);
		if (b > a) ranges.push({ from: a, to: b });
	};
	if (format === 'typst') {
		for (const run of typstProseRuns(syntaxTree(state), from, to)) {
			clip(run.from, run.to);
		}
	} else {
		const sliceDoc = (start: number, end: number) => state.sliceDoc(start, end);
		syntaxTree(state).iterate({
			from,
			to,
			enter(ref) {
				if (ref.name !== 'Normal') return;
				if (isProse(ref.node, sliceDoc)) clip(ref.from, ref.to);
			},
		});
	}
	const masks = getAnnotationMaskRanges(state).filter(
		(mask) => mask.from < to && mask.to > from,
	);
	if (masks.length === 0) return ranges;
	// The tags are not prose: what is left of each range around them.
	const kept: TextRange[] = [];
	for (const range of ranges) {
		let pieces = [range];
		for (const mask of masks) {
			pieces = pieces.flatMap((piece) =>
				mask.to <= piece.from || mask.from >= piece.to
					? [piece]
					: [
							{ from: piece.from, to: Math.max(piece.from, mask.from) },
							{ from: Math.min(piece.to, mask.to), to: piece.to },
						].filter((part) => part.to > part.from),
			);
		}
		kept.push(...pieces);
	}
	return kept;
}

class GrammarPlugin {
	private timer: ReturnType<typeof setTimeout> | null = null;
	private destroyed = false;
	private enabled: boolean | null = null;
	private backoffUntil = 0;
	private failed = false;
	private mainLanguage: SpellingLanguage | null | undefined;
	private readonly cache = new Map<string, GrammarMatch[]>();
	// Mistakes ignored here, until the editor closes: rule and text.
	readonly ignored = new Set<string>();
	// A rule turned on again in Settings: checked again.
	private readonly rulesChanged = () => this.schedule(0);

	constructor(
		private readonly view: EditorView,
		private readonly options: GrammarOptions,
	) {
		window.addEventListener(GRAMMAR_RULES_CHANGED, this.rulesChanged);
		void this.loadMainLanguage();
		this.schedule(SCAN_DELAY_MS);
	}

	update(update: ViewUpdate) {
		if (update.docChanged || update.viewportChanged) {
			this.schedule(SCAN_DELAY_MS);
		}
	}

	destroy() {
		this.destroyed = true;
		if (this.timer) clearTimeout(this.timer);
		window.removeEventListener(GRAMMAR_RULES_CHANGED, this.rulesChanged);
	}

	ignore(match: GrammarMatch, text: string, at: TextRange) {
		this.ignored.add(`${match.rule.id}\u0001${text}`);
		this.view.dispatch({ effects: dropIssues.of({ at }) });
	}

	disableRule(match: GrammarMatch) {
		disableGrammarRule(this.options.userId, {
			id: match.rule.id,
			description: match.shortMessage || match.message,
		});
		this.view.dispatch({ effects: dropIssues.of({ rule: match.rule.id }) });
	}

	schedule(delay: number) {
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => {
			this.timer = null;
			void this.scan();
		}, delay);
	}

	private language(state: EditorState): SpellingLanguage | null {
		const { spellingSetting, interfaceLanguage, format } = this.options;
		if (spellingSetting !== 'auto' && spellingSetting !== 'off') {
			return spellingSetting;
		}
		const preamble = state.sliceDoc(0, PREAMBLE_LENGTH);
		const declared =
			format === 'typst'
				? declaredTypstLanguage(preamble)
				: declaredLanguage(preamble);
		if (declared !== undefined) return declared;
		if (this.mainLanguage !== undefined) return this.mainLanguage;
		return (
			guessLanguage(preamble) ?? interfaceSpellingLanguage(interfaceLanguage)
		);
	}

	private async scan() {
		if (this.destroyed) return;
		if (Date.now() < this.backoffUntil) {
			this.schedule(this.backoffUntil - Date.now());
			return;
		}
		if (this.enabled === null) {
			this.enabled = await accountSyncService.grammarEnabled(
				this.options.userId,
			);
		}
		if (!this.enabled || this.destroyed) return;

		const { state } = this.view;
		const language = this.language(state);
		if (!language) return;
		const text = state.doc.toString();
		const disabled = disabledGrammarRules(this.options.userId).map(
			(rule) => rule.id,
		);
		const settings = `${language}\u0001${disabled.join(',')}`;

		const seen = new Set<number>();
		const chunks = this.view.visibleRanges
			.flatMap(({ from, to }) => paragraphsAround(text, from, to))
			.filter((chunk) => !seen.has(chunk.from) && seen.add(chunk.from));

		const ready: GrammarScan[] = [];
		const waiting: Array<
			TextRange & {
				key: string;
				text: string;
				annotation: ReturnType<typeof annotate>;
			}
		> = [];
		for (const chunk of chunks) {
			const chunkText = text.slice(chunk.from, chunk.to);
			const prose = proseRanges(
				state,
				chunk.from,
				chunk.to,
				this.options.format,
			).map((range) => ({
				from: range.from - chunk.from,
				to: range.to - chunk.from,
			}));
			const annotation = annotate(chunkText, prose, this.options.format);
			if (!hasWords(annotation)) {
				ready.push({ ...chunk, issues: [] });
				continue;
			}
			const key = `${settings}\u0001${chunkText}`;
			const known = this.cache.get(key);
			if (known) ready.push(this.issuesOf(chunk, chunkText, known));
			else waiting.push({ ...chunk, key, text: chunkText, annotation });
		}
		if (ready.length) this.view.dispatch({ effects: setIssues.of(ready) });

		const next = async (): Promise<void> => {
			const chunk = waiting.shift();
			if (!chunk || this.destroyed || Date.now() < this.backoffUntil) return;
			try {
				const matches = await accountSyncService.checkGrammar(
					this.options.userId,
					{
						language: grammarLanguageOf(language),
						annotation: chunk.annotation,
						disabledRules: disabled,
					},
				);
				this.remember(chunk.key, matches);
				this.failed = false;
				// Put where the paragraph still is, unchanged.
				if (
					!this.destroyed &&
					this.view.state.sliceDoc(chunk.from, chunk.to) === chunk.text
				) {
					this.view.dispatch({
						effects: setIssues.of([this.issuesOf(chunk, chunk.text, matches)]),
					});
				}
			} catch (error) {
				if (
					error instanceof AccountServerError &&
					[401, 404].includes(error.status)
				) {
					this.enabled = false;
					return;
				}
				if (
					error instanceof AccountServerError &&
					[429, 503].includes(error.status)
				) {
					this.backoffUntil = Date.now() + BACKOFF_MS;
					this.schedule(BACKOFF_MS);
					return;
				}
				// Tried again a little later: LanguageTool may have been
				// starting.
				if (!this.failed) moduleLog.warn('Grammar checking failed:', error);
				this.failed = true;
				this.backoffUntil = Date.now() + RETRY_MS;
				this.schedule(RETRY_MS);
				return;
			}
			await next();
		};
		await Promise.all(Array.from({ length: MAX_IN_FLIGHT }, () => next()));
	}

	private issuesOf(
		chunk: TextRange,
		chunkText: string,
		matches: GrammarMatch[],
	): GrammarScan {
		const issues: GrammarIssue[] = [];
		for (const match of matches) {
			if (match.offset + match.length > chunkText.length) continue;
			const found = chunkText.slice(match.offset, match.offset + match.length);
			if (this.ignored.has(`${match.rule.id}\u0001${found}`)) continue;
			issues.push({
				from: chunk.from + match.offset,
				to: chunk.from + match.offset + match.length,
				match,
			});
		}
		return { from: chunk.from, to: chunk.to, issues };
	}

	private remember(key: string, matches: GrammarMatch[]) {
		this.cache.set(key, matches);
		if (this.cache.size > MAX_CACHED) {
			const oldest = this.cache.keys().next().value;
			if (oldest !== undefined) this.cache.delete(oldest);
		}
	}

	// A file included from the main file follows the language it declares.
	private async loadMainLanguage() {
		const path = filePathCacheService.getMainFilePath();
		if (!path) return;
		try {
			const content = (await fileStoreService.getFileByPath(path))?.content;
			if (content === undefined || this.destroyed) return;
			const text =
				typeof content === 'string'
					? content
					: new TextDecoder().decode(content);
			const preamble = text.slice(0, PREAMBLE_LENGTH);
			this.mainLanguage = path.toLowerCase().endsWith('.typ')
				? declaredTypstLanguage(preamble)
				: declaredLanguage(preamble);
		} catch (error) {
			moduleLog.warn('Could not read the main file language:', error);
		}
	}
}

// What hovering a mistake shows: what LanguageTool says, its corrections,
// and to ignore it or turn its rule off.
function tooltipFor(
	view: EditorView,
	plugin: GrammarPlugin,
	issue: GrammarIssue,
): HTMLElement {
	const { match } = issue;
	const dom = document.createElement('div');
	dom.className = 'cm-grammar-tooltip';
	dom.setAttribute('data-role', 'grammar-tooltip');
	const message = document.createElement('p');
	message.className = 'cm-grammar-message';
	message.textContent = match.message;
	dom.append(message);

	const button = (
		label: string,
		action: string,
		run: () => void,
		title?: string,
	) => {
		const element = document.createElement('button');
		element.type = 'button';
		element.textContent = label;
		element.setAttribute('data-action', action);
		if (title) element.title = title;
		element.addEventListener('mousedown', (event) => event.preventDefault());
		element.addEventListener('click', (event) => {
			event.preventDefault();
			run();
		});
		return element;
	};

	const replacements = match.replacements.filter(Boolean).slice(0, 4);
	if (replacements.length && !view.state.readOnly) {
		const list = document.createElement('div');
		list.className = 'cm-grammar-replacements';
		for (const value of replacements) {
			list.append(
				button(value, 'grammar-replace', () => {
					view.dispatch({
						changes: { from: issue.from, to: issue.to, insert: value },
						selection: { anchor: issue.from + value.length },
						userEvent: 'input.complete',
					});
					view.focus();
				}),
			);
		}
		dom.append(list);
	}

	const actions = document.createElement('div');
	actions.className = 'cm-grammar-actions';
	actions.append(
		button(t('Ignore'), 'grammar-ignore', () =>
			plugin.ignore(match, view.state.sliceDoc(issue.from, issue.to), issue),
		),
		button(
			t('Turn this rule off'),
			'grammar-disable-rule',
			() => plugin.disableRule(match),
			t('Settings list the rules turned off, to turn them on again'),
		),
	);
	dom.append(actions);
	return dom;
}

/**
 * Underlines grammar and style mistakes in LaTeX or Typst prose, as the
 * account's server finds them with LanguageTool; nothing for an account the
 * server does not know, or a server without LanguageTool.
 */
export function createGrammarExtension(options: GrammarOptions): Extension {
	const plugin = ViewPlugin.define((view) => new GrammarPlugin(view, options));
	return [
		issuesField,
		plugin,
		hoverTooltip(
			(view, pos) => {
				let found: GrammarIssue | null = null;
				view.state.field(issuesField).between(pos, pos, (from, to, value) => {
					if (from <= pos && pos <= to) {
						found = { from, to, match: value.spec.match };
						return false;
					}
				});
				const issue = found as GrammarIssue | null;
				const instance = view.plugin(plugin);
				if (!issue || !instance) return null;
				return {
					pos: issue.from,
					end: issue.to,
					above: true,
					create: () => ({ dom: tooltipFor(view, instance, issue) }),
				};
			},
			{ hoverTime: 300 },
		),
	];
}
