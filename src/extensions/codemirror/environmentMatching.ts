// src/extensions/codemirror/environmentMatching.ts
// With the cursor on \begin{itemize} or on its \end{itemize}, both are
// marked, as brackets are (TeXstudio and LaTeX Workshop do the same): one
// sees where an environment ends. Their names differing (\begin{figure} …
// \end{table}), both are marked as mismatched. The pairs are the LaTeX
// parser's, nesting and verbatim counted.
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { type EditorState, type Extension, RangeSet } from '@codemirror/state';
import {
	Decoration,
	type DecorationSet,
	type EditorView,
	ViewPlugin,
	type ViewUpdate,
} from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';

/** A \begin{…} or \end{…}: the command, and its name between the braces. */
interface EnvironmentEnd {
	from: number;
	to: number;
	name: string;
}

export interface EnvironmentPair {
	begin: EnvironmentEnd;
	end: EnvironmentEnd;
	/** Both have the same name. */
	matched: boolean;
}

// Time given to parse up to the end of a long document, at most.
const PARSE_BUDGET_MS = 20;

/** \begin{name} or \end{name} (not the [options] after). */
function endOf(state: EditorState, node: SyntaxNode): EnvironmentEnd | null {
	const group = node.getChild('EnvNameGroup');
	if (!group) return null;
	const close = group.lastChild?.name === 'CloseBrace';
	return {
		from: node.from,
		to: group.to,
		name: state
			.sliceDoc(group.from + 1, close ? group.to - 1 : group.to)
			.trim(),
	};
}

/** The \begin/\end pair the cursor at `pos` is on, or null. */
export function environmentPairAt(
	state: EditorState,
	pos: number,
): EnvironmentPair | null {
	const tree =
		ensureSyntaxTree(state, state.doc.length, PARSE_BUDGET_MS) ??
		syntaxTree(state);
	for (const side of [-1, 1] as const) {
		for (
			let node: SyntaxNode | null = tree.resolveInner(pos, side);
			node;
			node = node.parent
		) {
			if (node.name !== 'BeginEnv' && node.name !== 'EndEnv') continue;
			const environment = node.parent;
			const beginNode = environment?.firstChild;
			const endNode = environment?.lastChild;
			if (beginNode?.name !== 'BeginEnv' || endNode?.name !== 'EndEnv')
				return null;
			const begin = endOf(state, beginNode);
			const end = endOf(state, endNode);
			if (!begin || !end) return null;
			const here = node.name === 'BeginEnv' ? begin : end;
			// On the command and its name, not in its [options].
			if (pos < here.from || pos > here.to) return null;
			return { begin, end, matched: begin.name === end.name };
		}
	}
	return null;
}

const matchedMark = Decoration.mark({
	class: 'cm-matchingBracket cm-environment-match',
});
const mismatchedMark = Decoration.mark({
	class: 'cm-nonmatchingBracket cm-environment-mismatch',
});

function decorationsFor(state: EditorState): DecorationSet {
	const { main } = state.selection;
	if (!main.empty) return Decoration.none;
	const pair = environmentPairAt(state, main.head);
	if (!pair) return Decoration.none;
	const mark = pair.matched ? matchedMark : mismatchedMark;
	return RangeSet.of([
		mark.range(pair.begin.from, pair.begin.to),
		mark.range(pair.end.from, pair.end.to),
	]);
}

export const environmentMatching: Extension = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;

		constructor(view: EditorView) {
			this.decorations = decorationsFor(view.state);
		}

		update(update: ViewUpdate) {
			if (
				update.selectionSet ||
				update.docChanged ||
				syntaxTree(update.state) !== syntaxTree(update.startState)
			)
				this.decorations = decorationsFor(update.state);
		}
	},
	{ decorations: (plugin) => plugin.decorations },
);
