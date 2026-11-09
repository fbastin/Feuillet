// src/extensions/codemirror/symbolPalette/SymbolPaletteExtension.ts
// The symbol palette, as on Overleaf: a panel under the editor, opened from
// the toolbar (Ω), with the symbols by category and a search. A click puts
// the symbol at the cursor: its LaTeX command, or its Typst name, in $…$
// when the cursor is not in math.
import { type Extension, StateEffect, StateField } from '@codemirror/state';
import { type EditorView, type Panel, showPanel } from '@codemirror/view';
import { scanLatexModes } from 'codemirror-lang-latex';
import katex from 'katex';
import 'katex/dist/katex.min.css';

import { t } from '@/i18n';
import { maskAnnotationText } from '../annotations/annotationMasking';
import {
	type MathTest,
	type PaletteFileType,
	SYMBOL_CATEGORIES,
	searchSymbols,
	symbolInsertion,
	symbolsIn,
	typstInMath,
} from './symbolInsert';
import type { PaletteSymbol, SymbolCategory } from './symbolPaletteData';

const latexInMath: MathTest = (state, pos) =>
	scanLatexModes(maskAnnotationText(state).slice(0, pos)).openMath;

const setSymbolPalette = StateEffect.define<boolean>();

const paletteOpen = StateField.define<boolean>({
	create: () => false,
	update(open, tr) {
		for (const effect of tr.effects) {
			if (effect.is(setSymbolPalette)) return effect.value;
		}
		return open;
	},
});

/** Opens or closes the palette; false where the editor has none. */
export function toggleSymbolPalette(view: EditorView): boolean {
	const open = view.state.field(paletteOpen, false);
	if (open === undefined) return false;
	view.dispatch({ effects: setSymbolPalette.of(!open) });
	if (open) view.focus();
	return true;
}

const categoryLabel = (category: SymbolCategory): string =>
	({
		greek: t('Greek'),
		arrows: t('Arrows'),
		operators: t('Operators'),
		relations: t('Relations'),
		misc: t('Miscellaneous'),
	})[category];

// Each symbol drawn once, as LaTeX would.
const glyphs = new Map<string, string>();
const glyph = (symbol: PaletteSymbol): string => {
	let html = glyphs.get(symbol.command);
	if (html === undefined) {
		try {
			html = katex.renderToString(symbol.command, {
				throwOnError: true,
				output: 'html',
			});
		} catch {
			html = '';
		}
		glyphs.set(symbol.command, html);
	}
	return html;
};

let lastCategory: SymbolCategory = 'greek';

const element = <K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className: string,
	text?: string,
): HTMLElementTagNameMap[K] => {
	const node = document.createElement(tag);
	node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
};

function createPalettePanel(
	view: EditorView,
	fileType: PaletteFileType,
): Panel {
	const inMath = fileType === 'latex' ? latexInMath : typstInMath;
	const inserted = (symbol: PaletteSymbol) =>
		fileType === 'latex' ? symbol.command : (symbol.typst ?? symbol.char);

	const dom = element('div', 'cm-symbol-palette');
	dom.setAttribute('role', 'region');
	dom.setAttribute('aria-label', t('Symbol palette'));

	const header = element('div', 'cm-symbol-palette-header');
	const tabs = element('div', 'cm-symbol-palette-tabs');
	tabs.setAttribute('role', 'tablist');
	const search = element('input', 'cm-symbol-palette-search');
	search.type = 'search';
	search.placeholder = t('Search symbols');
	search.setAttribute('aria-label', t('Search symbols'));
	search.spellcheck = false;
	const close = element('button', 'cm-symbol-palette-close', '×');
	close.type = 'button';
	close.title = t('Close the symbol palette');
	close.setAttribute('aria-label', t('Close the symbol palette'));
	header.append(tabs, search, close);

	const grid = element('div', 'cm-symbol-palette-grid');
	grid.id = `cm-symbol-palette-grid-${Math.random().toString(36).slice(2)}`;
	grid.setAttribute('role', 'tabpanel');
	const info = element('div', 'cm-symbol-palette-info');
	info.setAttribute('aria-live', 'polite');
	dom.append(header, grid, info);

	let shown: PaletteSymbol[] = [];
	let active = 0;

	const showInfo = (symbol: PaletteSymbol | null) => {
		info.replaceChildren();
		if (!symbol) {
			info.textContent = shown.length
				? t('Click a symbol to insert it.')
				: t('No symbols found');
			return;
		}
		info.append(
			element('code', 'cm-symbol-palette-command', inserted(symbol)),
			element('span', 'cm-symbol-palette-description', symbol.description()),
		);
		if (fileType === 'latex' && symbol.package) {
			info.append(
				element(
					'span',
					'cm-symbol-palette-package',
					`${t('Package:')} ${symbol.package}`,
				),
			);
		}
	};

	const buttons = () =>
		grid.querySelectorAll<HTMLButtonElement>('.cm-symbol-palette-symbol');

	const insert = (symbol: PaletteSymbol) => {
		const spec = symbolInsertion(view.state, symbol, fileType, inMath);
		if (!spec) return;
		view.dispatch(spec);
		view.focus();
	};

	const render = () => {
		const query = search.value.trim();
		shown = query ? searchSymbols(query) : symbolsIn(lastCategory);
		if (fileType === 'typst') {
			// Two LaTeX commands can draw one symbol (\emptyset and
			// \varnothing): Typst has one name for it, offered once.
			const seen = new Set<string>();
			shown = shown.filter((symbol) => {
				const key = symbol.typst ?? symbol.char;
				if (seen.has(key)) return false;
				seen.add(key);
				return true;
			});
		}
		active = 0;
		const tabbable = query ? SYMBOL_CATEGORIES[0] : lastCategory;
		for (const tab of tabs.querySelectorAll<HTMLElement>(
			'.cm-symbol-palette-tab',
		)) {
			const { category } = tab.dataset;
			tab.setAttribute(
				'aria-selected',
				String(!query && category === lastCategory),
			);
			tab.tabIndex = category === tabbable ? 0 : -1;
		}
		grid.replaceChildren(
			...shown.map((symbol, index) => {
				const button = element('button', 'cm-symbol-palette-symbol');
				button.type = 'button';
				button.tabIndex = index === 0 ? 0 : -1;
				button.dataset.command = symbol.command;
				const label = `${inserted(symbol)} — ${symbol.description()}`;
				button.title = label;
				button.setAttribute('aria-label', label);
				const html = glyph(symbol);
				if (html) button.innerHTML = html;
				else button.textContent = symbol.char;
				return button;
			}),
		);
		grid.setAttribute(
			'aria-label',
			query ? t('Search symbols') : categoryLabel(lastCategory),
		);
		showInfo(null);
	};

	for (const category of SYMBOL_CATEGORIES) {
		const tab = element(
			'button',
			'cm-symbol-palette-tab',
			categoryLabel(category),
		);
		tab.type = 'button';
		tab.setAttribute('role', 'tab');
		tab.setAttribute('aria-controls', grid.id);
		tab.dataset.category = category;
		tabs.append(tab);
	}

	const symbolAt = (target: EventTarget | null): number => {
		const button = (target as HTMLElement | null)?.closest?.(
			'.cm-symbol-palette-symbol',
		);
		return button ? Array.prototype.indexOf.call(buttons(), button) : -1;
	};

	const focusSymbol = (index: number) => {
		const all = buttons();
		if (all.length === 0) return;
		active = Math.max(0, Math.min(all.length - 1, index));
		for (const [i, button] of all.entries())
			button.tabIndex = i === active ? 0 : -1;
		all[active].focus();
	};

	// Columns as the grid lays them out, for the up and down keys.
	const columns = () =>
		Math.max(
			1,
			getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean)
				.length,
		);

	tabs.addEventListener('click', (event) => {
		const tab = (event.target as HTMLElement).closest<HTMLElement>(
			'.cm-symbol-palette-tab',
		);
		if (!tab?.dataset.category) return;
		lastCategory = tab.dataset.category as SymbolCategory;
		search.value = '';
		render();
	});
	tabs.addEventListener('keydown', (event) => {
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
		event.preventDefault();
		const index = SYMBOL_CATEGORIES.indexOf(lastCategory);
		const step = event.key === 'ArrowRight' ? 1 : -1;
		lastCategory =
			SYMBOL_CATEGORIES[
				(index + step + SYMBOL_CATEGORIES.length) % SYMBOL_CATEGORIES.length
			];
		search.value = '';
		render();
		(
			tabs.querySelector(`[data-category="${lastCategory}"]`) as HTMLElement
		)?.focus();
	});

	search.addEventListener('input', render);
	search.addEventListener('keydown', (event) => {
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			focusSymbol(0);
		} else if (event.key === 'Enter' && shown.length > 0) {
			event.preventDefault();
			insert(shown[0]);
		}
	});

	// Keep the editor's focus and selection while clicking a symbol.
	grid.addEventListener('mousedown', (event) => {
		if (symbolAt(event.target) >= 0) event.preventDefault();
	});
	grid.addEventListener('click', (event) => {
		const index = symbolAt(event.target);
		if (index >= 0) insert(shown[index]);
	});
	grid.addEventListener('mouseover', (event) => {
		const index = symbolAt(event.target);
		if (index >= 0) showInfo(shown[index]);
	});
	grid.addEventListener('mouseleave', () => showInfo(null));
	grid.addEventListener('focusin', (event) => {
		const index = symbolAt(event.target);
		if (index >= 0) {
			active = index;
			showInfo(shown[index]);
		}
	});
	grid.addEventListener('keydown', (event) => {
		const steps: Record<string, number> = {
			ArrowRight: 1,
			ArrowLeft: -1,
			ArrowDown: columns(),
			ArrowUp: -columns(),
		};
		if (event.key in steps) {
			event.preventDefault();
			if (event.key === 'ArrowUp' && active < columns()) search.focus();
			else focusSymbol(active + steps[event.key]);
		} else if (event.key === 'Home' || event.key === 'End') {
			event.preventDefault();
			focusSymbol(event.key === 'Home' ? 0 : shown.length - 1);
		}
	});

	close.addEventListener('click', () => {
		view.dispatch({ effects: setSymbolPalette.of(false) });
		view.focus();
	});
	dom.addEventListener('keydown', (event) => {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		event.stopPropagation();
		view.dispatch({ effects: setSymbolPalette.of(false) });
		view.focus();
	});

	render();
	return {
		dom,
		top: false,
		mount: () => search.focus(),
	};
}

/** The palette for LaTeX or Typst files, closed at first. */
export function symbolPalette(fileType: PaletteFileType): Extension {
	const create = (view: EditorView) => createPalettePanel(view, fileType);
	return [
		paletteOpen,
		showPanel.from(paletteOpen, (open) => (open ? create : null)),
	];
}
