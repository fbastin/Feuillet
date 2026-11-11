// src/extensions/codemirror/autocomplete/keyvalCompletion.ts
// The keys a command, an environment or a package takes in its options, as
// TeXstudio and LaTeX Workshop offer them: \includegraphics[width=…],
// \usepackage[margin=…]{geometry}, \begin{tcolorbox}[colback=…],
// \captionsetup[figure]{labelfont=…}; then, after =, the key's values
// (paper=a4paper). From TeXstudio's word lists (GNU GPL 3, see
// __generated__/texstudio/README.md), for the packages the project loads.
import {
	type Completion,
	type CompletionContext,
	type CompletionResult,
	type CompletionSource,
	pickedCompletion,
	snippet,
	startCompletion,
} from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';

import {
	literal,
	projectLoads,
	Template,
	wordListOrigins,
} from './packageCommandsCompletion';
import { TEX_LIVE_NAME_COMMANDS } from './texLiveNamesCompletion';
import type { KeyvalBlock } from './texstudioShards';

const LOOK_BACK = 3000;
const LOOK_AHEAD = 400;

// Openers and closers of arguments: { [ (, and the other way round.
const CLOSER: Record<string, string> = { '{': '}', '[': ']', '(': ')' };
const OPENER: Record<string, string> = { '}': '{', ']': '[', ')': '(' };

/** Where the cursor is, in a command's options. */
export interface KeyvalContext {
	/** \includegraphics, \begin{tcolorbox}, \usepackage. */
	command: string;
	/** The delimiters of its arguments, up to the one the cursor is in. */
	args: string;
	/** For \usepackage[…]{a,b} and \documentclass[…]{c}: the names. */
	names: string[];
	/** In a value: its key. */
	key: string | null;
	/** Where what is typed of the key or value starts, and that text. */
	from: number;
	typed: string;
}

const escaped = (text: string, at: number): boolean => {
	let slashes = 0;
	for (let i = at - 1; i >= 0 && text[i] === '\\'; i--) slashes++;
	return slashes % 2 === 1;
};

// Comments blanked out, places kept: a % not escaped, to the line's end.
const blankComments = (text: string): string =>
	text.replace(
		/(^|[^\\])((?:\\\\)*)(%.*)$/gm,
		(_all, before: string, slashes: string, comment: string) =>
			`${before}${slashes}${' '.repeat(comment.length)}`,
	);

const isOpener = (text: string, at: number) =>
	text[at] in CLOSER && !escaped(text, at);
const isCloser = (text: string, at: number) =>
	text[at] in OPENER && !escaped(text, at);

/** The opener of the innermost group still open at `pos`, or -1. */
function openerBefore(text: string, pos: number): number {
	const closed: string[] = [];
	for (let i = pos - 1; i >= 0; i--) {
		if (isCloser(text, i)) closed.push(text[i]);
		else if (isOpener(text, i)) {
			if (closed.length === 0) return i;
			if (closed.pop() !== CLOSER[text[i]]) return -1;
		}
	}
	return -1;
}

/** Where the group closed at `end` opens, or -1. */
function groupStart(text: string, end: number): number {
	const closed: string[] = [];
	for (let i = end; i >= 0; i--) {
		if (isCloser(text, i)) closed.push(text[i]);
		else if (isOpener(text, i)) {
			if (closed.pop() !== CLOSER[text[i]]) return -1;
			if (closed.length === 0) return i;
		}
	}
	return -1;
}

/**
 * Where the group open at `start` (the cursor after it) closes, or -1: not
 * past a paragraph's end.
 */
function groupEnd(text: string, start: number, pos: number): number {
	const open = [text[start]];
	for (let i = pos; i < text.length; i++) {
		if (text[i] === '\n' && /^\n[ \t]*\n/.test(text.slice(i, i + 40)))
			return -1;
		if (isOpener(text, i)) open.push(text[i]);
		else if (isCloser(text, i)) {
			if (CLOSER[open.pop() as string] !== text[i]) return -1;
			if (open.length === 0) return i;
		}
	}
	return -1;
}

/** The last top-level `char` in `text`, or -1. */
function lastTopLevel(text: string, char: string): number {
	let depth = 0;
	let found = -1;
	for (let i = 0; i < text.length; i++) {
		if (isOpener(text, i)) depth++;
		else if (isCloser(text, i)) depth--;
		else if (depth === 0 && text[i] === char) found = i;
	}
	return found;
}

/** Spaces back from `at`, one line break at most: the next character's place. */
function skipSpacesBack(text: string, at: number): number {
	let breaks = 0;
	let i = at;
	while (i >= 0 && /\s/.test(text[i])) {
		if (text[i] === '\n' && ++breaks > 1) break;
		i--;
	}
	return i;
}

/**
 * Whether `pos` in `text` is in a command's options, which, and what is
 * typed there; null elsewhere (in a comment, a command's name, a value's
 * braces).
 */
export function keyvalContext(
	source: string,
	pos: number,
): KeyvalContext | null {
	const text = blankComments(source);
	// In a comment: its line, before the cursor, is not what it was.
	const lineStart = source.lastIndexOf('\n', pos - 1) + 1;
	if (text.slice(lineStart, pos) !== source.slice(lineStart, pos)) return null;
	const opener = openerBefore(text, pos);
	if (opener < 0 || text[opener] === '(') return null;

	// The arguments before this one, back to the command's name.
	const delimiters = [text[opener]];
	const groups: { from: number; to: number }[] = [];
	let at = skipSpacesBack(text, opener - 1);
	while (at >= 0 && isCloser(text, at) && text[at] !== ')') {
		const start = groupStart(text, at);
		if (start < 0) return null;
		delimiters.unshift(text[start]);
		groups.unshift({ from: start, to: at });
		at = skipSpacesBack(text, start - 1);
	}
	const name = /\\[a-zA-Z@]+\*?$/.exec(
		text.slice(Math.max(0, at - 80), at + 1),
	)?.[0];
	if (!name || name === '\\end') return null;
	let command = name;
	if (name === '\\begin') {
		// Not in the environment's name: in an argument after it.
		if (groups.length === 0 || delimiters[0] !== '{') return null;
		command = `\\begin{${text.slice(groups[0].from + 1, groups[0].to).trim()}}`;
		delimiters.shift();
		groups.shift();
	}

	// \usepackage[…]{geometry}: the names after the options, the ] not
	// typed yet too (\usepackage[marg{geometry}: no ] is added before a {).
	let names: string[] = [];
	if (delimiters.join('') === '[') {
		const unclosed = /^[^[\]{}\n]*\{([^{}]*)\}/.exec(text.slice(pos));
		const end = unclosed ? -1 : groupEnd(text, opener, pos);
		const after =
			unclosed ??
			(end < 0 ? null : /^\s*\{([^{}]*)\}/.exec(text.slice(end + 1)));
		if (after)
			names = after[1]
				.split(',')
				.map((each) => each.trim())
				.filter(Boolean);
	}

	// The item the cursor is in, after the last comma, and its = if any.
	const inside = text.slice(opener + 1, pos);
	const itemFrom = opener + 1 + lastTopLevel(inside, ',') + 1;
	const item = text.slice(itemFrom, pos);
	const equals = lastTopLevel(item, '=');
	const key = equals < 0 ? null : item.slice(0, equals).trim();
	const typedFrom = equals < 0 ? itemFrom : itemFrom + equals + 1;
	const typedRaw = text.slice(typedFrom, pos);
	const typed = typedRaw.trimStart();
	// A command, a group or a second = being typed: not a key nor a value.
	if (/[\\{}[\]=]/.test(typed) || (key !== null && !key)) return null;
	return {
		command,
		args: delimiters.join(''),
		names,
		key,
		from: typedFrom + typedRaw.length - typed.length,
		typed,
	};
}

// --- The keys and their values ----------------------------------------------

/** One key, as offered, and the values it takes. */
export interface KeyItem {
	key: string;
	/** As shown: width=length, alt={alt text}, paper=. */
	display: string;
	/** Its values (paper=a4paper), when TeXstudio lists them. */
	values: string[];
	/** The snippet inserted, or the text. */
	template: string | null;
	insert: string;
}

// What ##L and the like stand for, as a placeholder.
const VALUE_TYPES: Record<string, string> = { L: 'length', l: 'label' };

// TeXstudio's %color: the colours xcolor always defines.
const COLORS = [
	'black',
	'blue',
	'brown',
	'cyan',
	'darkgray',
	'gray',
	'green',
	'lightgray',
	'lime',
	'magenta',
	'olive',
	'orange',
	'pink',
	'purple',
	'red',
	'teal',
	'violet',
	'white',
	'yellow',
];

/** a,{b,c},d: the values, braces kept together. */
function splitValues(text: string): string[] {
	const values: string[] = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i <= text.length; i++) {
		const char = text[i];
		if (char === '{') depth++;
		else if (char === '}') depth--;
		else if ((char === ',' && depth === 0) || i === text.length) {
			const value = text.slice(start, i).trim();
			if (value === '%color') values.push(...COLORS);
			// Placeholders and TeXstudio's own lists are not values to insert.
			else if (value && !value.includes('%')) values.push(value);
			start = i + 1;
		}
	}
	return [...new Set(values)];
}

/** A key as TeXstudio writes it: width=##L, clip#true,false, alt={%<text%>}. */
export function parseKeyval(line: string): KeyItem | null {
	const at = line.search(/[=#]/);
	const key = (at < 0 ? line : line.slice(0, at)).trim();
	if (!key || /[\\{}%]/.test(key)) return null;
	let rest = at < 0 ? '' : line.slice(at);
	const equals = rest.startsWith('=');
	if (equals) rest = rest.slice(1);
	if (rest.startsWith('##')) {
		const type = VALUE_TYPES[rest.slice(2)];
		return {
			key,
			display: `${key}=${type ?? ''}`,
			values: [],
			template: type ? `${literal(key)}=\${1:${type}}` : null,
			insert: `${key}=`,
		};
	}
	if (rest.startsWith('#')) {
		const values = splitValues(rest.slice(1));
		// true or false: the key alone says true.
		const flag = values.every((value) => value === 'true' || value === 'false');
		return {
			key,
			display: flag ? key : `${key}=`,
			values,
			template: null,
			insert: flag ? key : `${key}=`,
		};
	}
	if (rest) {
		const value = new Template();
		value.text(`${key}=${rest}`);
		return {
			key,
			display: value.display,
			values: [],
			template: value.hasFields ? value.template : null,
			insert: value.display,
		};
	}
	return {
		key,
		display: equals ? `${key}=` : key,
		values: [],
		template: null,
		insert: equals ? `${key}=` : key,
	};
}

// --- Which keys go where ------------------------------------------------------

/** One list of keys, for one owner: the arguments it is in, from where. */
interface OwnedKeys {
	args: string[];
	label: string;
	items: KeyItem[];
}

type KeyIndex = Map<string, OwnedKeys[]>;

const parsedBlocks = new WeakMap<KeyvalBlock, KeyItem[]>();
const itemsOfBlock = (block: KeyvalBlock): KeyItem[] => {
	let items = parsedBlocks.get(block);
	if (!items) {
		items = block[1]
			.map(parseKeyval)
			.filter((item): item is KeyItem => item !== null);
		parsedBlocks.set(block, items);
	}
	return items;
};

const data = () => import('./texstudioData');

const indexes = new Map<string, Promise<KeyIndex>>();

/** The keys of the word lists a project loads, by owner. */
function keyIndexFor(loads: string[]): Promise<KeyIndex> {
	const id = [...loads].sort().join(',');
	let index = indexes.get(id);
	if (!index) {
		// A few sets of packages kept (one changes as \usepackage is typed).
		if (indexes.size >= 8)
			indexes.delete(indexes.keys().next().value as string);
		index = (async () => {
			const { keyvalsOf } = await data();
			const origins = await wordListOrigins(loads);
			const names = [...origins.keys()];
			const lists = await Promise.all(names.map(keyvalsOf));
			const byOwner: KeyIndex = new Map();
			lists.forEach((blocks, i) => {
				// Named after what the project loads (caption, not caption3).
				const label = origins.get(names[i]) as string;
				for (const block of blocks) {
					for (const [owner, ...args] of block[0]) {
						const owned = byOwner.get(owner) ?? [];
						owned.push({
							args,
							label,
							get items() {
								return itemsOfBlock(block);
							},
						});
						byOwner.set(owner, owned);
					}
				}
			});
			return byOwner;
		})();
		indexes.set(id, index);
		index.catch(() => indexes.delete(id));
	}
	return index;
}

// \RequirePackage[…]{x} takes \usepackage's options, \LoadClass the class's.
const OPTIONS_OF: Record<string, string> = {
	'\\RequirePackage': '\\usepackage',
	'\\RequirePackageWithOptions': '\\usepackage',
	'\\LoadClass': '\\documentclass',
	'\\LoadClassWithOptions': '\\documentclass',
};

/** The keys for where the cursor is, each with its package. */
export function keysAt(
	index: KeyIndex,
	context: KeyvalContext,
): { item: KeyItem; label: string }[] {
	const found: OwnedKeys[] = [];
	const take = (owner: string, args: string | null) => {
		for (const owned of index.get(owner) ?? []) {
			// None said: the first argument.
			const here =
				args === null ||
				(owned.args.length > 0 ? owned.args.includes(args) : args.length === 1);
			if (here) found.push(owned);
		}
	};
	if (context.args === '[' && context.names.length > 0) {
		const command = OPTIONS_OF[context.command] ?? context.command;
		for (const name of context.names) take(`${command}/${name}`, null);
		// A class TeXstudio does not know: the standard classes' options.
		if (command === '\\documentclass' && found.length === 0)
			take('\\documentclass/article', null);
	}
	take(context.command, context.args);
	const seen = new Set<string>();
	const keys: { item: KeyItem; label: string }[] = [];
	for (const owned of found)
		for (const item of owned.items)
			if (!seen.has(item.key)) {
				seen.add(item.key);
				keys.push({ item, label: owned.label });
			}
	return keys;
}

// --- The completion -------------------------------------------------------------

// A key with values: inserted with its =, then its values offered.
const thenValues =
	(insert: string) =>
	(view: EditorView, completion: Completion, from: number, to: number) => {
		view.dispatch({
			changes: { from, to, insert },
			selection: { anchor: from + insert.length },
			annotations: pickedCompletion.of(completion),
			userEvent: 'input.complete',
		});
		startCompletion(view);
	};

const MAX_VALUES_SHOWN = 12;

function keyCompletion({
	item,
	label,
}: {
	item: KeyItem;
	label: string;
}): Completion {
	const shown = item.values.slice(0, MAX_VALUES_SHOWN).join(', ');
	return {
		label: item.key,
		displayLabel: item.display,
		detail: label,
		info: item.values.length
			? item.values.length > MAX_VALUES_SHOWN
				? `${shown}, …`
				: shown
			: undefined,
		type: 'property',
		apply:
			item.values.length > 0 && item.insert.endsWith('=')
				? thenValues(item.insert)
				: item.template
					? snippet(item.template)
					: item.insert,
	};
}

export function keyvalCompletion(): CompletionSource {
	return async (
		context: CompletionContext,
	): Promise<CompletionResult | null> => {
		const start = Math.max(0, context.pos - LOOK_BACK);
		const text = context.state.sliceDoc(
			start,
			Math.min(context.state.doc.length, context.pos + LOOK_AHEAD),
		);
		const where = keyvalContext(text, context.pos - start);
		if (!where) return null;
		// \usepackage{…} and the like: TeX Live's names are offered there.
		if (
			where.args.endsWith('{') &&
			TEX_LIVE_NAME_COMMANDS.has(where.command.slice(1))
		)
			return null;
		let index: KeyIndex;
		try {
			index = await keyIndexFor(projectLoads(context));
		} catch {
			return null;
		}
		if (context.aborted) return null;
		const keys = keysAt(index, where);
		const from = start + where.from;
		if (where.key === null) {
			if (keys.length === 0) return null;
			return {
				from,
				options: keys.map(keyCompletion),
				validFor: /^[^=,{}[\]\\%]*$/,
			};
		}
		const values = new Map<string, string>();
		for (const { item, label } of keys)
			if (item.key === where.key)
				for (const value of item.values)
					if (!values.has(value)) values.set(value, label);
		if (values.size === 0) return null;
		return {
			from,
			options: [...values].map(([value, label]) => ({
				label: value,
				detail: label,
				type: 'enum',
			})),
			validFor: /^[^=,{}[\]\\%]*$/,
		};
	};
}

// The LaTeX package's own short lists for \documentclass[, \usepackage[
// and \includegraphics[ (its expressions ending in \[[^\]]*$) give way to
// these keys; past them, inside the brackets, its command completion works
// again (width=0.5\textw offered keys instead of \textwidth).
const BUNDLED_OPTIONS = /\\\[\[\^\\\]\]\*\$$/;

export function withoutBundledOptions(
	source: CompletionSource,
): CompletionSource {
	return (context: CompletionContext) =>
		source(
			new Proxy(context, {
				get(target, property) {
					if (property === 'matchBefore')
						return (expression: RegExp) =>
							BUNDLED_OPTIONS.test(expression.source)
								? null
								: target.matchBefore(expression);
					const value = Reflect.get(target, property, target);
					return typeof value === 'function' ? value.bind(target) : value;
				},
			}),
		);
}
