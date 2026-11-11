// src/extensions/codemirror/autocomplete/packageCommandsCompletion.ts
// The commands and environments of the packages and the class a project
// loads, in the completion, as on Overleaf: \usepackage{siunitx} brings
// \qty{number}{unit}, \usetikzlibrary{arrows.meta} its own, \documentclass
// {beamer} \frametitle… From TeXstudio's word lists (GNU GPL 3, see
// __generated__/texstudio/README.md), loaded for the packages used only.
// Each argument is a field to fill; Tab goes to the next.
import {
	type Completion,
	type CompletionContext,
	type CompletionResult,
	type CompletionSource,
	snippet,
} from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';
import {
	commandIndex,
	environmentIndex,
	symbolIndex,
} from 'codemirror-lang-latex';

import { filePathCacheService } from '../../../services/FilePathCacheService';
import { definitionsHere } from './latexDefinitionsCompletion';
import type { TexstudioEntry } from './texstudioShards';

/** Loaded for every LaTeX file, as TeXstudio does. */
const BASE = ['latex-document', 'tex'];

// --- What a word list's line becomes ---------------------------------------

export interface WordListItem {
	kind: 'command' | 'environment';
	/** \qty, or the environment's name. */
	name: string;
	/** As shown: \qty{number}{unit}, tabular{cols}. */
	display: string;
	/** The snippet template inserted, or null for the name alone. */
	template: string | null;
}

const CLOSING: Record<string, string> = {
	'{': '}',
	'[': ']',
	'(': ')',
	'<': '>',
};

// Outside fields, a snippet reads \{ and \} as braces, and ${ or #{ as a
// field: LaTeX's own \{ is written \\{, and a brace after $ or # escaped.
// Other braces are left as they are (CodeMirror misplaces a field after
// several escaped braces).
const literal = (text: string): string =>
	text.replace(/\\([{}])/g, '\\\\$1').replace(/([#$])\{/g, '$1\\{');
const CURSOR_FIELD = `\${}`;

// %<text%> marks a field, %| the cursor; % and a word after an argument's
// name (unit%keyvals, label%l) tells TeXstudio what it holds.
const FIELD_MARKS = /%<(.*?)%>|%\|/g;
const fieldName = (text: string): string =>
	text
		.replace(/%[a-zA-Z]+$/, '')
		.replace(/[{}$#]/g, '')
		.trim();

/** An argument group starting at `from`, nested ones counted. */
function readGroup(text: string, from: number): number {
	const open = text[from];
	const close = CLOSING[open];
	let depth = 0;
	for (let i = from; i < text.length; i++) {
		if (text[i] === '\\') {
			i++;
			continue;
		}
		if (text.startsWith('%<', i)) {
			const end = text.indexOf('%>', i + 2);
			if (end >= 0) i = end + 1;
			continue;
		}
		if (text[i] === open && open !== close) depth++;
		else if (text[i] === close && --depth <= 0) return i;
	}
	return -1;
}

class Template {
	display = '';
	template = '';
	private fields = 0;
	private cursor = false;

	text(text: string): void {
		let last = 0;
		for (const match of text.matchAll(FIELD_MARKS)) {
			const before = text.slice(last, match.index);
			this.display += before;
			this.template += literal(before);
			if (match[0] === '%|') {
				this.cursor = true;
				// The cursor's stop, as a snippet writes it.
				this.template += CURSOR_FIELD;
			} else this.field(match[1]);
			last = (match.index ?? 0) + match[0].length;
		}
		const rest = text.slice(last);
		this.display += rest;
		this.template += literal(rest);
	}

	field(name: string): void {
		const clean = fieldName(name);
		this.display += clean;
		// Numbered, so that two arguments of the same name stay apart.
		this.template += `\${${++this.fields}:${clean}}`;
	}

	/** The arguments after a name: groups, then whatever text follows. */
	arguments(rest: string): string {
		let i = 0;
		while (i < rest.length && CLOSING[rest[i]]) {
			const end = readGroup(rest, i);
			if (end < 0) break;
			const open = rest[i];
			const content = rest.slice(i + 1, end);
			// A plain name is a field; text with commands or marks is kept.
			if (/\\|%[<|]/.test(content)) this.text(rest.slice(i, end + 1));
			else {
				this.display += open;
				this.template += literal(open);
				this.field(content);
				this.display += CLOSING[open];
				this.template += literal(CLOSING[open]);
			}
			i = end + 1;
		}
		return rest.slice(i);
	}

	get hasFields(): boolean {
		return this.fields > 0 || this.cursor;
	}

	/** A last stop after the arguments, unless a cursor mark says where. */
	finish(): string {
		return this.fields > 0 && !this.cursor
			? `${this.template}\${}`
			: this.template;
	}
}

export function parseWordListLine(line: string): WordListItem | null {
	const environment = /^\\begin\{([^{}%]+)\}/.exec(line);
	if (environment) {
		const name = environment[1];
		const args = new Template();
		const body = args.arguments(line.slice(environment[0].length)).trim();
		const content = body ? `${literal(body)} ` : '';
		return {
			kind: 'environment',
			name,
			display: `${name}${args.display}`,
			template: `${literal(name)}}${args.template}\n\t${content}\${}\n\\end{${literal(name)}}`,
		};
	}
	const command = /^\\(?:[a-zA-Z@]+\*?|[^a-zA-Z@\s])/.exec(line);
	if (!command) return null;
	const name = command[0];
	const args = new Template();
	args.text(name);
	const rest = args.arguments(line.slice(name.length));
	if (rest) args.text(rest);
	return {
		kind: 'command',
		name,
		display: args.display,
		template: args.hasFields ? args.finish() : null,
	};
}

// --- Loading the word lists ------------------------------------------------

// The loader comes when first wanted, with its table of the shard files.
const data = () => import('./texstudioData');
const entryOf = async (name: string): Promise<TexstudioEntry | undefined> =>
	(await data()).entryOf(name);

interface PackageItems {
	/** Shown beside each item: the package, or the class. */
	label: string;
	commands: Completion[];
	environments: Completion[];
}

const parsed = new Map<string, Promise<PackageItems | null>>();

// A } right after the cursor (closed by the editor) is replaced, not doubled.
const withClosingBrace =
	(insert: ReturnType<typeof snippet>) =>
	(view: EditorView, completion: Completion, from: number, to: number) => {
		const end = view.state.sliceDoc(to, to + 1) === '}' ? to + 1 : to;
		insert(view, completion, from, end);
	};

// Of the forms of one name, those without an optional argument first:
// \qty{number}{unit} before \qty[options]{number}{unit}.
function plainFirst(options: Completion[]): Completion[] {
	const byName = new Map<string, Completion[]>();
	for (const option of options)
		byName.set(option.label, [...(byName.get(option.label) ?? []), option]);
	const optional = (option: Completion) =>
		Number((option.displayLabel ?? '').startsWith(`${option.label}[`));
	return [...byName.values()].flatMap((forms) =>
		forms.sort((a, b) => optional(a) - optional(b)),
	);
}

function itemsOf(entry: TexstudioEntry): PackageItems {
	const [name, , lines] = entry;
	const label = name.replace(/^class-/, '');
	const commands: Completion[] = [];
	const environments: Completion[] = [];
	for (const line of lines) {
		const item = parseWordListLine(line);
		if (!item) continue;
		if (item.kind === 'environment') {
			environments.push({
				label: item.name,
				displayLabel: item.display,
				detail: label,
				type: 'class',
				apply: withClosingBrace(snippet(item.template ?? '')),
				boost: 0,
			});
		} else {
			commands.push({
				label: item.name,
				displayLabel: item.display,
				detail: label,
				type: 'function',
				apply: item.template ? snippet(item.template) : item.name,
				boost: 0,
			});
		}
	}
	return {
		label,
		commands: plainFirst(commands),
		environments: plainFirst(environments),
	};
}

function packageItems(name: string): Promise<PackageItems | null> {
	let items = parsed.get(name);
	if (!items) {
		items = entryOf(name).then((entry) => (entry ? itemsOf(entry) : null));
		parsed.set(name, items);
		items.catch(() => parsed.delete(name));
	}
	return items;
}

/** The word lists for what a project loads: classes by alias, includes. */
export async function wordListsFor(
	loads: readonly string[],
): Promise<string[]> {
	const { aliases } = await (await data()).loadCore();
	const start = [...BASE];
	for (const name of loads) {
		const className = name.startsWith('class-') ? name.slice(6) : null;
		start.push(...((className && aliases[className]) || [name]));
	}
	const seen = new Set<string>();
	let level = start;
	while (level.length > 0) {
		const fresh = [...new Set(level)].filter((name) => !seen.has(name));
		for (const name of fresh) seen.add(name);
		const entries = await Promise.all(fresh.map(entryOf));
		level = entries.flatMap((entry) => entry?.[1] ?? []);
	}
	return [...seen];
}

// --- The completion ----------------------------------------------------------

const merged = new Map<
	string,
	Promise<{ commands: Completion[]; environments: Completion[] }>
>();

function completionsFor(loads: string[]) {
	const key = [...loads].sort().join(',');
	let result = merged.get(key);
	if (!result) {
		// A few sets of packages kept (one changes as \usepackage is typed).
		if (merged.size >= 8) merged.delete(merged.keys().next().value as string);
		result = wordListsFor(loads)
			.then((names) => Promise.all(names.map(packageItems)))
			.then((all) => {
				const commands: Completion[] = [];
				const environments: Completion[] = [];
				const shown = new Set<string>();
				for (const items of all) {
					if (!items) continue;
					for (const option of items.commands) {
						const name = option.label;
						const seen = `c ${option.displayLabel}`;
						if (
							commandIndex.has(name) ||
							symbolIndex.has(name) ||
							shown.has(seen)
						)
							continue;
						shown.add(seen);
						commands.push(option);
					}
					for (const option of items.environments) {
						const seen = `e ${option.displayLabel}`;
						// LaTeX's own completion has it, but not with its
						// arguments (alignat{ncols}): those are kept.
						const bare = option.displayLabel === option.label;
						if ((bare && environmentIndex.has(option.label)) || shown.has(seen))
							continue;
						shown.add(seen);
						environments.push(option);
					}
				}
				return { commands, environments };
			});
		merged.set(key, result);
		result.catch(() => merged.delete(key));
	}
	return result;
}

/** What this file and the project's other LaTeX files load. */
function projectLoads(context: CompletionContext): string[] {
	const loads = new Set(definitionsHere(context.state).packages);
	for (const definitions of filePathCacheService.getTexDefinitions().values())
		for (const name of definitions.packages ?? []) loads.add(name);
	return [...loads];
}

export function packageCommandsCompletion(): CompletionSource {
	return async (
		context: CompletionContext,
	): Promise<CompletionResult | null> => {
		const environment = context.matchBefore(/\\(?:begin|end)\s*\{[a-zA-Z*]*$/);
		const command = environment
			? null
			: context.matchBefore(/\\[a-zA-Z@]*\*?$/);
		if (!environment && !command) return null;
		let found: { commands: Completion[]; environments: Completion[] };
		try {
			found = await completionsFor(projectLoads(context));
		} catch {
			return null;
		}
		if (context.aborted) return null;
		if (environment) {
			if (!environment.text.startsWith('\\begin')) return null;
			return found.environments.length === 0
				? null
				: {
						from: environment.from + environment.text.lastIndexOf('{') + 1,
						options: found.environments,
						validFor: /^[a-zA-Z*]*$/,
					};
		}
		if (!command || found.commands.length === 0) return null;
		return {
			from: command.from,
			options: found.commands,
			validFor: /^\\[a-zA-Z@]*\*?$/,
		};
	};
}
