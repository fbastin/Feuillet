// server/collab/annotations.js
// Comments and tracked changes as the editor writes them in a document's
// text (src/utils/annotationTagUtils.ts, src/services/CommentService.ts,
// src/services/ReviewService.ts):
//
//   `<### comment id: X, user: U, time: T, content64: 'b64', responses: [...], resolved: false ###>`text`</### comment id: X ###>`
//   `<### review id: X, user: U, time: T, original: 'b64', responses: [...], resolved: false ###>`new text`</### review id: X ###>`
//
// A tracked change keeps, base64-encoded, the text it replaces; a deletion
// has no new text. The text people read is the text without the tags, every
// tracked change shown as made.

const crypto = require('node:crypto');

const KINDS = ['comment', 'review'];
const SEP = '(?:\\s|%)*';
const ID_ALPHABET =
	'ModuleSymbhasOwnPr-0123456789ABCDEFGHNRVfgctiUvz_KqYTJkLxpZXIjQW';

const encode = (text) => Buffer.from(text, 'utf8').toString('base64');
const decode = (encoded) => {
	try {
		return Buffer.from(String(encoded).trim(), 'base64').toString('utf8');
	} catch {
		return '';
	}
};

// An id as the editor's (nanoid): 21 characters of [A-Za-z0-9_-].
const newId = () => {
	const bytes = crypto.randomBytes(21);
	let id = '';
	for (const byte of bytes) id += ID_ALPHABET[byte & 63];
	return id;
};

// The tags of one kind, as the editor pairs them: each opening tag with the
// next closing tag of the same id, the backticks around them included.
const scan = (text, kind) => {
	const matches = [];
	if (!new RegExp(`<###${SEP}${kind}${SEP}id:`).test(text)) return matches;
	const openTag = new RegExp(`<###${SEP}${kind}${SEP}id:${SEP}([\\w-]+)`, 'g');
	let searchStart = 0;
	while (searchStart < text.length) {
		openTag.lastIndex = searchStart;
		const open = openTag.exec(text);
		if (!open) break;
		const openTagStart = open.index;
		const id = open[1];
		const backtickBefore = openTagStart > 0 && text[openTagStart - 1] === '`';
		const openTagEnd = text.indexOf('###>', openTagStart);
		if (openTagEnd === -1) {
			searchStart = openTagStart + 1;
			continue;
		}
		const backtickAfter =
			openTagEnd + 4 < text.length && text[openTagEnd + 4] === '`';
		const openTagContent = text
			.substring(openTagStart, openTagEnd + 4)
			.replace(/\n\s*%\s*/g, ' ');
		const closeTag = new RegExp(
			`<\\/###${SEP}${kind}${SEP}id:${SEP}${id}${SEP}###>`,
			'g',
		);
		closeTag.lastIndex = openTagEnd + 4;
		const close = closeTag.exec(text);
		if (!close) {
			searchStart = openTagEnd + 4;
			continue;
		}
		const closeTagStart = close.index;
		const closeTagEnd = closeTagStart + close[0].length;
		openTag.lastIndex = openTagEnd + 4;
		const nextOpen = openTag.exec(text);
		if (nextOpen && nextOpen[1] === id && nextOpen.index < closeTagStart) {
			searchStart = openTagEnd + 4;
			continue;
		}
		const closeBacktick = backtickBefore && text[closeTagStart - 1] === '`';
		matches.push({
			kind,
			id,
			openTagContent,
			innerStart: openTagEnd + 4 + (backtickAfter ? 1 : 0),
			innerEnd: closeTagStart - (closeBacktick ? 1 : 0),
			openTagStart: backtickBefore ? openTagStart - 1 : openTagStart,
			openTagEnd: backtickAfter ? openTagEnd + 5 : openTagEnd + 4,
			closeTagStart: closeBacktick ? closeTagStart - 1 : closeTagStart,
			closeTagEnd:
				backtickAfter && closeTagEnd < text.length && text[closeTagEnd] === '`'
					? closeTagEnd + 1
					: closeTagEnd,
		});
		searchStart = openTagEnd + 4;
	}
	return matches;
};

const scanAll = (text) => KINDS.flatMap((kind) => scan(text, kind));

// Where the tags are, merged where they touch.
const tagRanges = (matches) => {
	const ranges = matches
		.flatMap((match) => [
			{ from: match.openTagStart, to: match.openTagEnd },
			{ from: match.closeTagStart, to: match.closeTagEnd },
		])
		.filter((range) => range.from < range.to)
		.sort((a, b) => a.from - b.from);
	const merged = [];
	for (const range of ranges) {
		const last = merged[merged.length - 1];
		if (last && range.from <= last.to) last.to = Math.max(last.to, range.to);
		else merged.push({ ...range });
	}
	return merged;
};

/**
 * The text people read, without the tags, and a map from its offsets back to
 * the stored text: `rawStart(i)` is where the clean offset i starts after
 * any tags there, `rawEnd(i)` where it ends before them.
 */
const cleanView = (text) => {
	const matches = scanAll(text);
	const ranges = tagRanges(matches);
	let clean = '';
	// [cleanOffset, rawOffset] at the start of each run of plain text.
	const runs = [];
	let pos = 0;
	for (const range of ranges) {
		if (range.from > pos) {
			runs.push([clean.length, pos]);
			clean += text.substring(pos, range.from);
		}
		pos = Math.max(pos, range.to);
	}
	if (pos < text.length || runs.length === 0) {
		runs.push([clean.length, pos]);
		clean += text.substring(pos);
	}
	const runOf = (offset, last) => {
		let found = 0;
		for (let i = 0; i < runs.length; i++) {
			if (runs[i][0] < offset || (runs[i][0] === offset && !last)) found = i;
			if (runs[i][0] > offset) break;
		}
		return runs[found];
	};
	return {
		text: clean,
		matches,
		ranges,
		// After any tags at this offset: where an inserted text or an edited
		// passage starts.
		rawStart: (offset) => {
			const [cleanStart, rawStart] = runOf(offset, false);
			return rawStart + offset - cleanStart;
		},
		// Before any tags at this offset: where an edited passage ends.
		rawEnd: (offset) => {
			const [cleanStart, rawStart] = runOf(offset, true);
			return rawStart + offset - cleanStart;
		},
	};
};

const strip = (text) => cleanView(text).text;

const field = (content, name) => {
	const encoded = content.match(new RegExp(`${name}64:\\s*'([^']*)'`, 's'));
	if (encoded) return decode(encoded[1]);
	const plain = content.match(new RegExp(`${name}:\\s*'([^']*)'`, 's'));
	return plain ? plain[1].replace(/\s+/g, ' ').trim() : '';
};

const parseResponses = (content) => {
	const list = content.match(/responses:\s*\[(.*?)\]/s)?.[1] ?? '';
	const responses = [];
	const pattern =
		/<####(?:\s|%)*response(?:\s|%)*id:(?:\s|%)*'([\w-]+)',(?:\s|%)*user:(?:\s|%)*([^,]+?),(?:\s|%)*time:(?:\s|%)*(\d+),(?:\s|%)*content(64)?:(?:\s|%)*'([^']*)'(?:\s|%)*####\/>/g;
	for (const match of list.replace(/\n\s*%\s*/g, ' ').matchAll(pattern)) {
		const [, id, user, time, encoded, content64] = match;
		responses.push({
			id,
			user: user.trim(),
			time: Number(time),
			content: encoded
				? decode(content64)
				: content64.replace(/\s+/g, ' ').trim(),
		});
	}
	return responses;
};

const formatResponses = (responses) =>
	responses
		.map(
			(response) =>
				`<#### response id: '${response.id}', user: ${response.user}, time: ${response.time}, content64: '${encode(response.content)}' ####/>`,
		)
		.join(', ');

/** The comments and tracked changes of a text, open ones first. */
const annotationsOf = (text) => {
	const view = cleanView(text);
	const lineAt = (rawOffset) => text.substring(0, rawOffset).split('\n').length;
	return view.matches
		.map((match) => {
			const content = match.openTagContent;
			const base = {
				kind: match.kind,
				id: match.id,
				user: content.match(/user:\s*([^,]+?)(?=\s*,)/)?.[1]?.trim() ?? '',
				time: Number(content.match(/time:\s*(\d+)/)?.[1] ?? 0),
				resolved: /resolved:\s*true/.test(content),
				line: lineAt(match.openTagStart),
				text: strip(text.substring(match.innerStart, match.innerEnd)),
				responses: parseResponses(content),
			};
			return match.kind === 'comment'
				? { ...base, comment: field(content, 'content') }
				: {
						...base,
						original: decode(
							content.match(/original:\s*'([^']*)'/)?.[1] ?? '',
						),
					};
		})
		.sort((a, b) => Number(a.resolved) - Number(b.resolved) || a.line - b.line);
};

// Names go in tags unquoted, up to the next comma.
const tagUser = (name) =>
	String(name)
		.replace(/[,\n\r'`#<>]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 100) || 'Claude';

const reviewTags = (user, original, time = Date.now()) => {
	const id = newId();
	return {
		id,
		open: `\`<### review id: ${id}, user: ${tagUser(user)}, time: ${time}, original: '${encode(original)}', responses: [], resolved: false ###>\``,
		close: `\`</### review id: ${id} ###>\``,
	};
};

const commentTags = (user, comment, time = Date.now()) => {
	const id = newId();
	return {
		id,
		open: `\`<### comment id: ${id}, user: ${tagUser(user)}, time: ${time}, content64: '${encode(comment)}', responses: [], resolved: false ###>\``,
		close: `\`</### comment id: ${id} ###>\``,
	};
};

/** The text with one more reply to an annotation. */
const withResponse = (text, match, user, content, time = Date.now()) => {
	const responses = [
		...parseResponses(match.openTagContent),
		{ id: newId(), user: tagUser(user), time, content },
	];
	const tag = text.substring(match.openTagStart, match.openTagEnd);
	const replaced = tag.replace(
		/responses:\s*\[(.*?)\]/s,
		() => `responses: [${formatResponses(responses)}]`,
	);
	return (
		text.substring(0, match.openTagStart) +
		replaced +
		text.substring(match.openTagEnd)
	);
};

module.exports = {
	annotationsOf,
	cleanView,
	commentTags,
	reviewTags,
	scan,
	scanAll,
	strip,
	tagUser,
	withResponse,
};
