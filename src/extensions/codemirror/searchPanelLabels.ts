// src/extensions/codemirror/searchPanelLabels.ts
// The search panel (Ctrl+F) draws its options as glyphs, « Aa », « .* »,
// with their names as tooltips. The tooltips were English text in the
// style sheet, and « Match whole word » the letters « |w| ». Each control
// gets its translated name (data-tip, which the style sheet shows), and
// « Match whole word » the sign code editors and the sidebar search use:
// « ab » on a bracket.
import { searchPanelOpen } from '@codemirror/search';
import { type EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';

import { t } from '@/i18n';

const SVG_NS = 'http://www.w3.org/2000/svg';

const wholeWordIcon = (): SVGSVGElement => {
	const svg = document.createElementNS(SVG_NS, 'svg');
	svg.setAttribute('class', 'cm-search-word-icon');
	svg.setAttribute('viewBox', '0 0 18 16');
	svg.setAttribute('aria-hidden', 'true');
	const text = document.createElementNS(SVG_NS, 'text');
	for (const [name, value] of Object.entries({
		x: '9',
		y: '10',
		'text-anchor': 'middle',
		'font-size': '12.5',
		'font-family': 'inherit',
		fill: 'currentColor',
	})) {
		text.setAttribute(name, value);
	}
	text.textContent = 'ab';
	const bracket = document.createElementNS(SVG_NS, 'path');
	for (const [name, value] of Object.entries({
		d: 'M1.5 11.5v2.5h15v-2.5',
		fill: 'none',
		stroke: 'currentColor',
		'stroke-width': '1.2',
		'stroke-linecap': 'round',
		'stroke-linejoin': 'round',
	})) {
		bracket.setAttribute(name, value);
	}
	svg.append(text, bracket);
	return svg;
};

const tips = (): Record<string, string> => ({
	case: t('Match case'),
	word: t('Match whole word'),
	re: t('Regular expression'),
	prev: t('Previous match'),
	next: t('Next match'),
	select: t('Select all matches'),
	close: t('Close search'),
	replace: t('Replace'),
	replaceAll: t('Replace all'),
});

const label = (panel: HTMLElement) => {
	if (panel.dataset.labelled) return;
	panel.dataset.labelled = 'true';
	const texts = tips();
	for (const control of panel.querySelectorAll<HTMLElement>(
		'button[name], label',
	)) {
		const name =
			control.getAttribute('name') ??
			control.querySelector('input')?.getAttribute('name') ??
			'';
		const tip = texts[name];
		if (!tip) continue;
		control.dataset.tip = tip;
		if (name === 'word') control.append(wholeWordIcon());
	}
};

export const searchPanelLabels = ViewPlugin.fromClass(
	class {
		constructor(readonly view: EditorView) {
			this.schedule();
		}

		update(update: ViewUpdate) {
			if (searchPanelOpen(update.state) && !searchPanelOpen(update.startState))
				this.schedule();
		}

		// The panel is in the page once this update is drawn.
		schedule() {
			if (!searchPanelOpen(this.view.state)) return;
			requestAnimationFrame(() => {
				const panel = this.view.dom.querySelector<HTMLElement>(
					'.cm-panel.cm-search',
				);
				if (panel) label(panel);
			});
		}
	},
);
