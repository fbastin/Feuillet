import { ensureSyntaxTree } from '@codemirror/language';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { typst_lezer } from 'codemirror-lang-typst/lezer';

import en from '../../../../translations/locales/en.json';
import fr from '../../../../translations/locales/fr.json';

// The interface in French or in English, from the translation files.
let language: 'fr' | 'en' = 'fr';
jest.mock('@/i18n', () => ({
	t: (key: string, options: Record<string, string> = {}) => {
		const texts = (language === 'fr' ? fr : en) as Record<string, string>;
		return (texts[key] ?? key).replace(
			/\{\{(\w+)\}\}/g,
			(_, name) => options[name] ?? '',
		);
	},
}));

// The LaTeX package is an ES module only: its math scan, for dollars only.
jest.mock('codemirror-lang-latex', () => ({
	scanLatexModes: (text: string) => ({
		openMath: (text.replace(/\\\$/g, '').match(/\$/g) ?? []).length % 2 === 1,
	}),
}));

import {
	symbolPalette,
	toggleSymbolPalette,
} from '@src/extensions/codemirror/symbolPalette/SymbolPaletteExtension';
import {
	SYMBOL_CATEGORIES,
	searchSymbols,
	symbolInsertion,
	symbolText,
	symbolsIn,
	typstInMath,
} from '@src/extensions/codemirror/symbolPalette/symbolInsert';
import {
	PALETTE_SYMBOLS,
	type PaletteSymbol,
} from '@src/extensions/codemirror/symbolPalette/symbolPaletteData';

const symbol = (command: string): PaletteSymbol => {
	const found = PALETTE_SYMBOLS.find((s) => s.command === command);
	if (!found) throw new Error(command);
	return found;
};

afterEach(() => {
	language = 'fr';
});

describe('symbol palette data', () => {
	it('has every category, each command once, every description in French', () => {
		for (const category of SYMBOL_CATEGORIES) {
			expect(symbolsIn(category).length).toBeGreaterThan(30);
		}
		const commands = PALETTE_SYMBOLS.map((s) => s.command);
		expect(new Set(commands).size).toBe(commands.length);
		const keys = new Set(Object.keys(fr));
		const missing = PALETTE_SYMBOLS.filter(
			(s) =>
				!keys.has(s.en) &&
				!/^Greek (small|capital) letter /.test(s.en),
		).map((s) => s.en);
		expect(missing).toEqual([]);
		expect(symbol('\\rightarrow').description()).toBe('Flèche vers la droite');
		expect(symbol('\\alpha').description()).toBe('Lettre grecque minuscule alpha');
		expect(symbol('\\varphi').description()).toBe(
			'Lettre grecque minuscule phi (variante)',
		);
		expect(symbol('\\Omega').description()).toBe('Lettre grecque majuscule Omega');
		language = 'en';
		expect(symbol('\\rightarrow').description()).toBe('Rightwards arrow');
	});
});

describe('symbol search', () => {
	const commands = (query: string) => searchSymbols(query).map((s) => s.command);

	it('finds by command, first the command named so', () => {
		expect(commands('in')[0]).toBe('\\in');
		expect(commands('\\alpha')).toEqual(['\\alpha']);
		expect(commands('leq').slice(0, 2)).toEqual(['\\leq', '\\leqslant']);
	});

	it('finds by description in French, accents or not, and in English', () => {
		expect(commands('flèche droite')).toContain('\\rightarrow');
		expect(commands('fleche droite')).toContain('\\rightarrow');
		expect(commands('rightwards arrow')).toContain('\\rightarrow');
		expect(commands('ensemble vide')).toEqual(['\\emptyset', '\\varnothing']);
		expect(commands('réels')).toEqual(['\\mathbb{R}']);
	});

	it('finds by character, Typst name and other words', () => {
		// ↛ is → with a stroke once accents are left out.
		expect(commands('→')).toEqual(['\\rightarrow', '\\nrightarrow']);
		expect(commands('arrow.r.double')[0]).toBe('\\Rightarrow');
		expect(commands('implies')).toContain('\\Longrightarrow');
		expect(commands('')).toEqual([]);
		expect(commands('zzz')).toEqual([]);
	});
});

describe('the inserted LaTeX', () => {
	const latex = (command: string, inMath: boolean, after = '') =>
		symbolText(symbol(command), 'latex', inMath, '', after);

	it('is the command in math, in $…$ outside', () => {
		expect(latex('\\alpha', true)).toBe('\\alpha');
		expect(latex('\\alpha', false)).toBe('$\\alpha$');
		expect(latex('\\mathbb{R}', false)).toBe('$\\mathbb{R}$');
		// Valid in text too.
		expect(latex('\\ldots', false)).toBe('\\ldots');
		expect(latex('\\checkmark', false)).toBe('\\checkmark');
	});

	it('keeps a letter after the command apart', () => {
		expect(latex('\\alpha', true, 'x')).toBe('\\alpha ');
		expect(latex('\\alpha', true, '_')).toBe('\\alpha');
		expect(latex('\\|', true, 'x')).toBe('\\|');
		expect(latex('\\mathbb{R}', true, 'x')).toBe('\\mathbb{R}');
	});
});

describe('the inserted Typst', () => {
	const typst = (command: string, inMath: boolean, before = '', after = '') =>
		symbolText(symbol(command), 'typst', inMath, before, after);

	it("is Typst's name in math, in $…$ outside, else the character", () => {
		expect(typst('\\rightarrow', true)).toBe('arrow.r');
		expect(typst('\\rightarrow', false)).toBe('$arrow.r$');
		expect(typst('\\mathbb{R}', true)).toBe('RR');
		expect(typst('\\neq', true)).toBe('≠');
	});

	it('keeps it apart from letters and digits around', () => {
		expect(typst('\\alpha', true, 'x', 'y')).toBe(' alpha ');
		expect(typst('\\alpha', true, ' ', '+')).toBe('alpha');
		expect(typst('\\neq', true, 'x', 'y')).toBe('≠');
	});

	it('knows when the cursor is in an equation', () => {
		const doc = 'Texte $a + b$ et\n$ sum_i x $\n$$\n';
		const state = EditorState.create({ doc, extensions: [typst_lezer()] });
		ensureSyntaxTree(state, doc.length, 5000);
		const at = (text: string, offset = 0) => typstInMath(state, doc.indexOf(text) + offset);
		expect(at('Texte', 2)).toBe(false);
		expect(at('a + b')).toBe(true);
		expect(at('a + b', 5)).toBe(true);
		expect(at(' et')).toBe(false);
		expect(at('sum_i')).toBe(true);
		expect(at('$$\n', 1)).toBe(true);
		expect(at('$$\n', 0)).toBe(false);
	});
});

describe('symbol insertion', () => {
	it('replaces the selection and puts the cursor after', () => {
		const state = EditorState.create({
			doc: 'soit x dans E',
			selection: EditorSelection.range(5, 6),
		});
		const spec = symbolInsertion(state, symbol('\\alpha'), 'latex', () => false);
		const next = state.update(spec!).state;
		expect(next.doc.toString()).toBe('soit $\\alpha$ dans E');
		expect(next.selection.main.head).toBe(13);
	});

	it('changes nothing in a read-only editor', () => {
		const state = EditorState.create({
			doc: 'x',
			extensions: EditorState.readOnly.of(true),
		});
		expect(symbolInsertion(state, symbol('\\alpha'), 'latex', () => true)).toBeNull();
	});
});

describe('symbol palette panel', () => {
	let view: EditorView;
	const panel = () => view.dom.querySelector<HTMLElement>('.cm-symbol-palette');
	const symbols = () =>
		[...view.dom.querySelectorAll<HTMLButtonElement>('.cm-symbol-palette-symbol')];

	beforeEach(() => {
		view = new EditorView({
			state: EditorState.create({
				doc: 'On a $x = $ ici.',
				selection: EditorSelection.cursor(10),
				extensions: [symbolPalette('latex')],
			}),
			parent: document.body,
		});
	});
	afterEach(() => view.destroy());

	it('opens and closes from the toolbar, and with Escape', () => {
		expect(panel()).toBeNull();
		expect(toggleSymbolPalette(view)).toBe(true);
		expect(panel()).not.toBeNull();
		expect(document.activeElement?.className).toBe('cm-symbol-palette-search');
		expect(toggleSymbolPalette(view)).toBe(true);
		expect(panel()).toBeNull();
		toggleSymbolPalette(view);
		panel()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		expect(panel()).toBeNull();
	});

	it('shows a category, the symbols found, and inserts the one clicked', () => {
		toggleSymbolPalette(view);
		const tabs = [...panel()!.querySelectorAll('[role="tab"]')];
		expect(tabs.map((tab) => tab.textContent)).toEqual([
			'Grec',
			'Flèches',
			'Opérateurs',
			'Relations',
			'Divers',
		]);
		expect(symbols().length).toBe(symbolsIn('greek').length);
		(tabs[1] as HTMLElement).click();
		expect(tabs[1].getAttribute('aria-selected')).toBe('true');
		expect(symbols()[0].getAttribute('aria-label')).toBe(
			'\\leftarrow — Flèche vers la gauche',
		);

		const search = panel()!.querySelector<HTMLInputElement>('input')!;
		search.value = 'infini';
		search.dispatchEvent(new Event('input'));
		expect(symbols().map((b) => b.dataset.command)).toEqual(['\\infty']);
		symbols()[0].dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
		expect(panel()!.querySelector('.cm-symbol-palette-info')?.textContent).toBe(
			'\\inftyInfini',
		);
		symbols()[0].click();
		expect(view.state.doc.toString()).toBe('On a $x = \\infty$ ici.');

		search.value = 'carré noir';
		search.dispatchEvent(new Event('input'));
		symbols()[0].dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
		expect(panel()!.querySelector('.cm-symbol-palette-info')?.textContent).toBe(
			'\\blacksquareCarré noirPaquet : amssymb',
		);
		search.value = 'zzz';
		search.dispatchEvent(new Event('input'));
		expect(symbols()).toEqual([]);
		expect(panel()!.querySelector('.cm-symbol-palette-info')?.textContent).toBe(
			'Aucun symbole trouvé',
		);
	});

	it('inserts the first symbol found with Enter', () => {
		view.dispatch({ selection: EditorSelection.cursor(15) });
		toggleSymbolPalette(view);
		const search = panel()!.querySelector<HTMLInputElement>('input')!;
		search.value = 'alpha';
		search.dispatchEvent(new Event('input'));
		search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		expect(view.state.doc.toString()).toBe('On a $x = $ ici$\\alpha$.');
	});
});
