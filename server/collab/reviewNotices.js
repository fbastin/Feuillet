// server/collab/reviewNotices.js
// Emails about the review: who replies to a comment tells, by email, those
// who wrote in its thread; a comment or a reply naming someone (@name)
// tells them too. Only accounts of the project, with a confirmed address,
// who did not turn these emails off (the account preference
// review-email-notifications).
//
//   POST /review/notify {project, comment, reply?, document?, response?,
//                        language} (token) -> {sent}
//
// The page asks once it wrote a comment, or a reply (`reply`: its latest
// reply in that thread, or `response`, the reply's id); the server finds the
// document (or reads `document`) and acts only on what this account just
// wrote there, so that nobody can have Feuillet mail on another's behalf.
// The assistants (mcp.js) call `notify` directly.

const { annotationsOf } = require('./annotations');

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const RECENT_MS = 10 * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_SENDER = 60;
const MAX_RECIPIENTS = 20;
const MAX_DOCUMENTS = 300;
const SENT_KEEP_MS = 24 * 60 * 60 * 1000;
const MENTION = /(?:^|[^\w@.-])@([A-Za-z0-9][A-Za-z0-9_.-]{0,62}[A-Za-z0-9_]|[A-Za-z0-9])/g;

class NoticeError extends Error {
	constructor(status, code) {
		super(code);
		this.status = status;
		this.code = code;
	}
}

/** The account a tag names: « bastin », or « Claude (bastin) » for assistants. */
const accountNameOf = (tagUser) => {
	const name = String(tagUser ?? '').trim();
	return /\(([^()]+)\)$/.exec(name)?.[1]?.trim() ?? name;
};

/** The names a text mentions: @bastin, @marie.curie. */
const mentionsOf = (text) =>
	[...String(text ?? '').matchAll(MENTION)].map((match) => match[1]);

const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

const linkIds = (entry) =>
	[
		entry.editId,
		/^yjs:([A-Za-z0-9_-]+)/.exec(String(entry.docUrl ?? ''))?.[1],
		entry.id,
	].filter((id, index, all) => id && all.indexOf(id) === index);

const createReviewNotices = ({
	accounts,
	shares,
	files,
	mailer,
	appUrl = '',
	log,
	now = Date.now,
}) => {
	const appBase = String(appUrl).replace(/\/+$/, '');
	const recent = new Map();
	const sent = new Map();

	setInterval(() => {
		const at = now();
		for (const [key, times] of recent) {
			if (times.every((time) => at - time >= WINDOW_MS)) recent.delete(key);
		}
		for (const [key, time] of sent) {
			if (at - time >= SENT_KEEP_MS) sent.delete(key);
		}
	}, WINDOW_MS).unref();

	const limit = (sender) => {
		const at = now();
		const times = (recent.get(sender) ?? []).filter(
			(time) => at - time < WINDOW_MS,
		);
		if (times.length >= MAX_PER_SENDER) {
			throw new NoticeError(429, 'too_many_notices');
		}
		times.push(at);
		recent.set(sender, times);
	};

	// The link through which an account reaches the project, or null.
	const linkOf = (account, project) => {
		for (const entry of account.projects ?? []) {
			if (entry.trashedAt) continue;
			for (const id of linkIds(entry)) {
				if (shares.accessOf(account.id, id)?.project === project) return id;
			}
		}
		return null;
	};

	/**
	 * Mails about what `sender` just wrote in a comment thread of a document
	 * of `project`. Returns how many emails went.
	 */
	// The document holding a comment, read: the one named, or found among
	// the project's.
	const findThread = async (project, document, comment) => {
		const documents = document
			? [document]
			: [...(await files.manifest(project)).values()]
					.map((entry) => entry.documentId)
					.filter(Boolean)
					.slice(0, MAX_DOCUMENTS);
		for (const documentId of documents) {
			const content = await files.read(project, { documentId }).catch(() => null);
			if (!content?.document || typeof content.text !== 'string') continue;
			if (!content.text.includes(comment)) continue;
			const thread = annotationsOf(content.text).find(
				(entry) => entry.id === comment,
			);
			if (thread) return { thread, document: documentId };
		}
		return null;
	};

	const notify = async ({
		sender,
		project,
		document: named,
		comment,
		response: replyId,
		reply: replied = false,
		language,
	}) => {
		if (!mailer) return 0;
		const found = await findThread(project, named, comment);
		if (!found) return 0;
		const { thread, document } = found;

		const at = now();
		const recentEnough = (time) => at - time < RECENT_MS && time - at < RECENT_MS;
		// The reply meant: by its id, or this account's latest in the thread.
		const response =
			replyId ??
			(replied
				? thread.responses
						.filter(
							(entry) =>
								same(accountNameOf(entry.user), sender.username) &&
								recentEnough(entry.time),
						)
						.sort((a, b) => b.time - a.time)[0]?.id
				: undefined);
		if (replied && !response) return 0;
		let event;
		let written;
		const recipients = new Set();
		if (response) {
			const reply = thread.responses.find((entry) => entry.id === response);
			if (!reply || !same(accountNameOf(reply.user), sender.username)) return 0;
			if (!recentEnough(reply.time)) return 0;
			event = 'reply';
			written = reply.content;
			for (const name of [thread.user, ...thread.responses.map((r) => r.user)]) {
				recipients.add(accountNameOf(name));
			}
		} else {
			if (thread.kind !== 'comment') return 0;
			if (!same(accountNameOf(thread.user), sender.username)) return 0;
			if (!recentEnough(thread.time)) return 0;
			event = 'comment';
			written = thread.comment;
		}
		const mentioned = new Set(mentionsOf(written).map((name) => name.toLowerCase()));
		for (const name of mentioned) recipients.add(name);

		const { metadata } = await files.settings(project).catch(() => ({ metadata: {} }));
		let count = 0;
		for (const name of [...recipients].slice(0, MAX_RECIPIENTS)) {
			if (!name || same(name, sender.username)) continue;
			const found = accounts.findAccount(name);
			if (!found) continue;
			const recipient = accounts.accountById(found.id);
			const link = recipient ? linkOf(recipient, project) : null;
			if (!link) continue;
			const contact = accounts.reviewContactOf(found.id);
			if (!contact?.email || !contact.enabled) continue;
			const key = `${project}:${document}:${comment}:${response ?? ''}:${found.id}`;
			if (sent.has(key)) continue;
			sent.set(key, at);
			const why =
				event === 'reply' && !mentioned.has(name.toLowerCase())
					? 'reply'
					: event === 'reply'
						? 'mention-reply'
						: 'mention';
			try {
				await mailer.send('review', {
					to: contact.email,
					language: contact.language ?? language,
					username: recipient.username,
					inviter: sender.username,
					project: metadata?.name,
					why,
					passage: thread.text,
					comment: event === 'reply' ? thread.comment ?? '' : '',
					written,
					link: `${appBase}/#yjs:${link}&doc:${document}`,
				});
				count++;
			} catch (error) {
				// Over the limits, or the mail server: the others may still go.
				sent.delete(key);
				log('review email not sent', error?.code ?? error?.message ?? error);
			}
		}
		return count;
	};

	const readBody = (req) =>
		new Promise((resolve, reject) => {
			const chunks = [];
			let size = 0;
			req.on('data', (chunk) => {
				size += chunk.length;
				if (size > 4096) {
					reject(new NoticeError(413, 'too_large'));
					req.destroy();
					return;
				}
				chunks.push(chunk);
			});
			req.on('end', () => {
				try {
					resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
				} catch {
					reject(new NoticeError(400, 'bad_request'));
				}
			});
			req.on('error', () => reject(new NoticeError(400, 'interrupted')));
		});

	const reply = (res, status, body) => {
		res.writeHead(status, {
			'Content-Type': 'application/json',
			'Cache-Control': 'no-store',
		});
		res.end(JSON.stringify(body));
	};

	const handles = (url) => url === '/review/notify';

	const handle = async (req, res) => {
		if (req.method !== 'POST') {
			req.resume();
			res.setHeader('Allow', 'POST, OPTIONS');
			reply(res, 405, { error: 'method_not_allowed' });
			return;
		}
		try {
			const senderId = await accounts.identify(req);
			const body = await readBody(req);
			const link = String(body?.project ?? '');
			const optional = (value) =>
				value === undefined || value === null ? undefined : String(value);
			const document = optional(body?.document);
			const comment = String(body?.comment ?? '');
			const response = optional(body?.response);
			if (
				!ID.test(link) ||
				!ID.test(comment) ||
				(document !== undefined && !ID.test(document)) ||
				(response !== undefined && !ID.test(response))
			) {
				throw new NoticeError(400, 'bad_request');
			}
			const sender = accounts.accountById(senderId);
			const access = sender ? shares.accessOf(sender.id, link) : null;
			if (!access || (access.access !== 'edit' && access.access !== 'review')) {
				throw new NoticeError(403, 'forbidden');
			}
			limit(sender.id);
			const count = await notify({
				sender,
				project: access.project,
				document,
				comment,
				response,
				reply: body.reply === true,
				language: typeof body.language === 'string' ? body.language : undefined,
			});
			reply(res, 200, { sent: count });
		} catch (error) {
			req.resume();
			if (error instanceof NoticeError || error?.status) {
				reply(res, error.status, { error: error.code });
			} else {
				log('review notice failed', error?.message ?? error);
				reply(res, 500, { error: 'server_error' });
			}
		}
	};

	return { handles, handle, notify };
};

module.exports = { createReviewNotices, accountNameOf, mentionsOf };
