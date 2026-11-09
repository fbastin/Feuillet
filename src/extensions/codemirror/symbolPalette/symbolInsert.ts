// src/extensions/codemirror/symbolPalette/symbolInsert.ts
// What the symbol palette inserts, and its search.
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import type { EditorState, TransactionSpec } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';

import {
	PALETTE_SYMBOLS,
	type PaletteSymbol,
	type SymbolCategory,
} from './symbolPaletteData';

export type PaletteFileType = 'latex' | 'typst';

/** Whether the position is in math, where a symbol goes as it is. */
export type MathTest = (state: EditorState, pos: number) => boolean;

/** Typst: in an equation, between its dollar signs. */
export const typstInMath: MathTest = (state, pos) => {
	const tree = ensureSyntaxTree(state, pos, 200) ?? syntaxTree(state);
	for (const side of [-1, 1] as const) {
		for (
			let node: SyntaxNode | null = tree.resolveInner(pos, side);
			node;
			node = node.parent
		) {
			if (node.name === 'Equation' && node.from < pos && pos < node.to)
				return true;
		}
	}
	return false;
};

/** The text inserted for a symbol, given what is around the cursor. */
export function symbolText(
	symbol: PaletteSymbol,
	fileType: PaletteFileType,
	inMath: boolean,
	before: string,
	after: string,
): string {
	if (fileType === 'latex') {
		const { command } = symbol;
		// Outside math, \alpha alone is an error: it goes in $…$.
		if (!inMath && !symbol.text) return `$${command}$`;
		// \alpha before a letter would make another command (\alphax).
		return /[a-zA-Z]$/.test(command) && /^[a-zA-Z]/.test(after)
			? `${command} `
			: command;
	}
	const name = symbol.typst ?? symbol.char;
	if (!inMath) return `$${name}$`;
	// In Typst math, letters together make one name: x alpha, not xalpha.
	const space = (edge: string, near: string) =>
		/[\p{L}\p{N}]/u.test(edge) && /[\p{L}\p{N}_.]/u.test(near) ? ' ' : '';
	return `${space(name[0], before)}${name}${space(name.at(-1) ?? '', after)}`;
}

/** The change that puts the symbol in place of the selection. */
export function symbolInsertion(
	state: EditorState,
	symbol: PaletteSymbol,
	fileType: PaletteFileType,
	inMath: MathTest,
): TransactionSpec | null {
	if (state.readOnly) return null;
	const { from, to } = state.selection.main;
	const text = symbolText(
		symbol,
		fileType,
		inMath(state, from),
		state.sliceDoc(Math.max(0, from - 1), from),
		state.sliceDoc(to, to + 1),
	);
	return {
		changes: { from, to, insert: text },
		selection: { anchor: from + text.length },
		scrollIntoView: true,
		userEvent: 'input.symbol',
	};
}

// Accents and case left out, so that « fleche » finds « Flèche ».
const fold = (text: string): string =>
	text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * The symbols whose command, character, Typst name or description (in the
 * user's language or in English) holds every word of the query; the
 * commands named so first.
 */
export function searchSymbols(
	query: string,
	symbols: readonly PaletteSymbol[] = PALETTE_SYMBOLS,
): PaletteSymbol[] {
	const words = fold(query).split(/\s+/).filter(Boolean);
	if (words.length === 0) return [];
	const name = words.join(' ').replace(/^\\/, '');
	const rank = (symbol: PaletteSymbol): number => {
		const command = fold(symbol.command.slice(1));
		if (command === name || fold(symbol.typst ?? '') === name) return 0;
		return command.startsWith(name) ? 1 : 2;
	};
	return symbols
		.filter((symbol) => {
			const text = fold(
				[
					symbol.command,
					symbol.char,
					symbol.typst ?? '',
					symbol.en,
					symbol.description(),
					symbol.aliases ?? '',
				].join(' '),
			);
			return words.every((word) => text.includes(word));
		})
		.map((symbol, index) => ({ symbol, index, rank: rank(symbol) }))
		.sort((a, b) => a.rank - b.rank || a.index - b.index)
		.map(({ symbol }) => symbol);
}

export const SYMBOL_CATEGORIES: readonly SymbolCategory[] = [
	'greek',
	'arrows',
	'operators',
	'relations',
	'misc',
];

export const symbolsIn = (category: SymbolCategory): PaletteSymbol[] =>
	PALETTE_SYMBOLS.filter((symbol) => symbol.category === category);
