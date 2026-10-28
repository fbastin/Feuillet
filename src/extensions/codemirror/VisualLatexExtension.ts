// src/extensions/codemirror/VisualLatexExtension.ts
import {
	EditorState,
	type Extension,
	Prec,
	type Range,
	StateEffect,
	StateField,
} from '@codemirror/state';
import {
	Decoration,
	type DecorationSet,
	EditorView,
	WidgetType,
	keymap,
} from '@codemirror/view';
import katex from 'katex';
import 'katex/dist/katex.min.css';

import { t } from '@/i18n';
import { fileStoreService } from '../../services/FileStoreService';
import { type VisualToken, scanVisualTokens } from './visual/visualTokens';

const PREFERENCE_KEY = 'feuillet-visual-editor';
const PREFERENCE_EVENT = 'feuillet-visual-editor-change';

/** Whether this browser shows LaTeX documents in the visual editor. */
export const readVisualPreference = (): boolean => {
	try {
		return localStorage.getItem(PREFERENCE_KEY) === 'true';
	} catch {
		return false;
	}
};

export const writeVisualPreference = (visual: boolean): void => {
	try {
		localStorage.setItem(PREFERENCE_KEY, String(visual));
	} catch {
		// Kept for this page only.
	}
	window.dispatchEvent(new CustomEvent(PREFERENCE_EVENT, { detail: visual }));
};

export const onVisualPreferenceChange = (
	listener: (visual: boolean) => void,
): (() => void) => {
	const handler = (event: Event) =>
		listener((event as CustomEvent<boolean>).detail);
	window.addEventListener(PREFERENCE_EVENT, handler);
	return () => window.removeEventListener(PREFERENCE_EVENT, handler);
};

export const setVisualMode = StateEffect.define<boolean>();

const visualModeField = StateField.define<boolean>({
	create: () => false,
	update(value, tr) {
		for (const effect of tr.effects) {
			if (effect.is(setVisualMode)) return effect.value;
		}
		return value;
	},
});

// The document scanned, only while the visual editor is on.
const tokensField = StateField.define<VisualToken[]>({
	create: (state) =>
		state.field(visualModeField, false)
			? scanVisualTokens(state.doc.toString())
			: [],
	update(tokens, tr) {
		const visual = tr.state.field(visualModeField);
		if (!visual) return tokens.length ? [] : tokens;
		const turnedOn = !tr.startState.field(visualModeField);
		return tr.docChanged || turnedOn
			? scanVisualTokens(tr.state.doc.toString())
			: tokens;
	},
});

// Clicking a widget puts the cursor on what it stands for, which shows its
// LaTeX for editing.
const revealOnClick = (view: EditorView, dom: HTMLElement) => {
	dom.addEventListener('mousedown', (event) => {
		event.preventDefault();
		const pos = view.posAtDOM(dom);
		view.dispatch({ selection: { anchor: pos }, scrollIntoView: false });
		view.focus();
	});
};

class MathWidget extends WidgetType {
	constructor(
		readonly tex: string,
		readonly display: boolean,
		readonly block: boolean,
	) {
		super();
	}
	eq(other: MathWidget) {
		return (
			other.tex === this.tex &&
			other.display === this.display &&
			other.block === this.block
		);
	}
	toDOM(view: EditorView) {
		const dom = document.createElement(this.block ? 'div' : 'span');
		dom.className = this.display
			? 'cm-visual-math cm-visual-math-display'
			: 'cm-visual-math';
		katex.render(this.tex || '\\square', dom, {
			displayMode: this.display,
			throwOnError: false,
			output: 'html',
			strict: 'ignore',
		});
		revealOnClick(view, dom);
		return dom;
	}
	ignoreEvent() {
		return false;
	}
}

class TextWidget extends WidgetType {
	constructor(
		readonly text: string,
		readonly className: string,
		readonly title = '',
	) {
		super();
	}
	eq(other: TextWidget) {
		return (
			other.text === this.text &&
			other.className === this.className &&
			other.title === this.title
		);
	}
	toDOM(view: EditorView) {
		const dom = document.createElement('span');
		dom.className = this.className;
		dom.textContent = this.text;
		if (this.title) dom.title = this.title;
		revealOnClick(view, dom);
		return dom;
	}
	ignoreEvent() {
		return false;
	}
}

class PreambleWidget extends WidgetType {
	constructor(readonly lines: number) {
		super();
	}
	eq(other: PreambleWidget) {
		return other.lines === this.lines;
	}
	toDOM(view: EditorView) {
		const dom = document.createElement('div');
		dom.className = 'cm-visual-preamble';
		dom.textContent = t('Preamble ({count} lines) — click to show', {
			count: this.lines,
		});
		revealOnClick(view, dom);
		return dom;
	}
	ignoreEvent() {
		return false;
	}
}

class TitleWidget extends WidgetType {
	constructor(
		readonly title: string,
		readonly author: string,
		readonly date: string,
	) {
		super();
	}
	eq(other: TitleWidget) {
		return (
			other.title === this.title &&
			other.author === this.author &&
			other.date === this.date
		);
	}
	toDOM(view: EditorView) {
		const dom = document.createElement('div');
		dom.className = 'cm-visual-title';
		for (const [text, className] of [
			[this.title, 'cm-visual-title-main'],
			[this.author, 'cm-visual-title-meta'],
			[this.date, 'cm-visual-title-meta'],
		]) {
			if (!text) continue;
			const line = document.createElement('div');
			line.className = className;
			line.textContent = text;
			dom.appendChild(line);
		}
		if (!dom.childElementCount) dom.textContent = '\\maketitle';
		revealOnClick(view, dom);
		return dom;
	}
	ignoreEvent() {
		return false;
	}
}

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.svg', '.gif', '.pdf'];

class ImageWidget extends WidgetType {
	private url: string | null = null;

	constructor(readonly path: string) {
		super();
	}
	eq(other: ImageWidget) {
		return other.path === this.path;
	}
	toDOM(view: EditorView) {
		const dom = document.createElement('div');
		dom.className = 'cm-visual-image';
		dom.textContent = this.path;
		revealOnClick(view, dom);
		void this.load(dom);
		return dom;
	}
	private async load(dom: HTMLElement) {
		const base = this.path.replace(/^\.?\//, '');
		const candidates = /\.[a-z0-9]+$/i.test(base)
			? [base]
			: IMAGE_EXTENSIONS.map((extension) => `${base}${extension}`);
		for (const candidate of candidates) {
			const file = await fileStoreService
				.getFileByPath(`/${candidate}`)
				.catch(() => undefined);
			if (!file?.content || file.isDeleted) continue;
			if (candidate.toLowerCase().endsWith('.pdf')) {
				dom.textContent = `PDF · ${candidate}`;
				return;
			}
			const type = candidate.toLowerCase().endsWith('.svg')
				? 'image/svg+xml'
				: (file.mimeType ?? '');
			this.url = URL.createObjectURL(new Blob([file.content], { type }));
			const image = document.createElement('img');
			image.src = this.url;
			image.alt = candidate;
			dom.replaceChildren(image);
			return;
		}
	}
	destroy() {
		if (this.url) URL.revokeObjectURL(this.url);
	}
	ignoreEvent() {
		return false;
	}
}

const HEADING_CLASSES = [
	'cm-visual-h0',
	'cm-visual-h1',
	'cm-visual-h2',
	'cm-visual-h3',
	'cm-visual-h4',
];
const FORMAT_CLASSES = {
	bold: 'cm-visual-bold',
	italic: 'cm-visual-italic',
	underline: 'cm-visual-underline',
	mono: 'cm-visual-mono',
	smallcaps: 'cm-visual-smallcaps',
	caption: 'cm-visual-caption',
};

const hide = Decoration.replace({});

// Markup shows where the cursor is, and is hidden everywhere else.
const buildDecorations = (state: EditorState): DecorationSet => {
	if (!state.field(visualModeField)) return Decoration.none;
	const tokens = state.field(tokensField);
	const { doc, selection } = state;
	const active = (from: number, to: number) =>
		selection.ranges.some((range) => range.to >= from && range.from <= to);
	// Writing inside a heading or emphasis keeps it as it looks; its markup
	// shows once the cursor reaches the markup, where typing would touch it.
	const markupActive = (token: {
		from: number;
		to: number;
		open: { to: number };
		close: { from: number };
	}) =>
		selection.ranges.some(
			(range) =>
				range.to >= token.from &&
				range.from <= token.to &&
				!(range.from > token.open.to && range.to < token.close.from),
		);

	// Hidden or replaced spans: whatever lies inside them is not drawn.
	const replaced: Array<{ from: number; to: number }> = [];
	const inside = (from: number, to: number) =>
		replaced.some((span) => from >= span.from && to <= span.to);
	const decorations: Range<Decoration>[] = [];
	const replace = (from: number, to: number, decoration: Decoration) => {
		if (from >= to || inside(from, to)) return;
		replaced.push({ from, to });
		decorations.push(decoration.range(from, to));
	};

	// Spans that hold others first, so that what they hide is skipped.
	const order = (token: VisualToken) =>
		token.kind === 'preamble' ? 0 : token.kind === 'math' ? 1 : 2;
	const sorted = [...tokens].sort(
		(a, b) => order(a) - order(b) || a.from - b.from,
	);

	for (const token of sorted) {
		if (inside(token.from, token.to)) continue;
		const isActive = active(token.from, token.to);
		switch (token.kind) {
			case 'preamble':
				if (!isActive) {
					replace(
						token.from,
						token.to,
						Decoration.replace({
							widget: new PreambleWidget(token.lines),
							block: true,
						}),
					);
				}
				break;
			case 'hiddenLine': {
				const line = doc.lineAt(token.from === 0 ? 0 : token.from + 1);
				if (!active(line.from, line.to)) replace(token.from, token.to, hide);
				break;
			}
			case 'env':
				decorations.push(
					Decoration.mark({ class: 'cm-visual-env' }).range(
						token.from,
						token.to,
					),
				);
				break;
			case 'comment':
				decorations.push(
					Decoration.mark({ class: 'cm-visual-comment' }).range(
						token.from,
						token.to,
					),
				);
				break;
			case 'heading': {
				const line = doc.lineAt(token.from);
				decorations.push(
					Decoration.line({ class: HEADING_CLASSES[token.level] }).range(
						line.from,
					),
				);
				if (!markupActive(token)) {
					replace(token.open.from, token.open.to, hide);
					replace(token.close.from, token.close.to, hide);
				}
				break;
			}
			case 'format':
			case 'link':
				if (token.open.to < token.close.from) {
					decorations.push(
						Decoration.mark({
							class:
								token.kind === 'link'
									? 'cm-visual-link'
									: FORMAT_CLASSES[token.style],
						}).range(token.open.to, token.close.from),
					);
				}
				if (!markupActive(token)) {
					replace(token.open.from, token.open.to, hide);
					replace(token.close.from, token.close.to, hide);
				}
				break;
			case 'item': {
				const line = doc.lineAt(token.from);
				decorations.push(
					Decoration.line({
						class: 'cm-visual-item',
						attributes: { style: `--cm-visual-level: ${token.level}` },
					}).range(line.from),
				);
				if (!isActive) {
					replace(
						token.from,
						token.to,
						Decoration.replace({
							widget: new TextWidget(token.marker, 'cm-visual-marker'),
						}),
					);
				}
				break;
			}
			case 'math': {
				if (isActive) {
					decorations.push(
						Decoration.mark({ class: 'cm-visual-math-source' }).range(
							token.from,
							token.to,
						),
					);
					break;
				}
				const first = doc.lineAt(token.from);
				const last = doc.lineAt(token.to);
				// A formula on lines of its own shows as a block.
				const block =
					token.display &&
					doc.sliceString(first.from, token.from).trim() === '' &&
					doc.sliceString(token.to, last.to).trim() === '';
				replace(
					block ? first.from : token.from,
					block ? last.to : token.to,
					Decoration.replace({
						widget: new MathWidget(token.tex, token.display, block),
						block,
					}),
				);
				break;
			}
			case 'chip':
				if (!isActive) {
					replace(
						token.from,
						token.to,
						Decoration.replace({
							widget: new TextWidget(
								token.style === 'cite' ? `[${token.text}]` : token.text,
								`cm-visual-chip cm-visual-chip-${token.style}`,
							),
						}),
					);
				}
				break;
			case 'escape':
				if (!isActive) {
					replace(
						token.from,
						token.to,
						Decoration.replace({
							widget: new TextWidget(token.text, 'cm-visual-escape'),
						}),
					);
				}
				break;
			case 'image':
				if (!isActive) {
					replace(
						token.from,
						token.to,
						Decoration.replace({ widget: new ImageWidget(token.path) }),
					);
				}
				break;
			case 'title':
				if (!isActive) {
					replace(
						token.from,
						token.to,
						Decoration.replace({
							widget: new TitleWidget(token.title, token.author, token.date),
						}),
					);
				}
				break;
		}
	}
	return Decoration.set(decorations, true);
};

const decorationsField = StateField.define<DecorationSet>({
	create: buildDecorations,
	update(decorations, tr) {
		const changed =
			tr.docChanged ||
			tr.selection ||
			tr.effects.some((effect) => effect.is(setVisualMode));
		return changed ? buildDecorations(tr.state) : decorations;
	},
	provide: (field) => EditorView.decorations.from(field),
});

type ArgumentToken = Extract<
	VisualToken,
	{ kind: 'heading' | 'format' | 'link' }
>;

const hasArgument = (token: VisualToken): token is ArgumentToken =>
	token.kind === 'heading' || token.kind === 'format' || token.kind === 'link';

// A heading alone at the end of its line, whose closing brace is its end.
const endsLine = (state: EditorState, token: ArgumentToken) =>
	token.kind === 'heading' &&
	state.doc.sliceString(token.to, state.doc.lineAt(token.to).to).trim() === '';

// A click at the end of a heading's line, or End from inside a heading,
// emphasis or a link, stops at the end of its text, before the hidden closing
// brace, so that what is typed there goes in it. Arrows still pass the brace.
const keepInsideArgument = EditorState.transactionFilter.of((tr) => {
	if (tr.docChanged || !tr.selection) return tr;
	if (!tr.startState.field(visualModeField, false)) return tr;
	const after = tr.selection.main;
	const before = tr.startState.selection.main;
	if (!after.empty || tr.selection.ranges.length > 1) return tr;
	const pointer = tr.isUserEvent('select.pointer');
	for (const token of tr.startState.field(tokensField)) {
		if (!hasArgument(token) || after.head !== token.to) continue;
		const fromInside =
			before.empty &&
			before.head > token.open.to &&
			before.head < token.close.from;
		if (
			(pointer && endsLine(tr.startState, token)) ||
			(!pointer && fromInside)
		) {
			return [tr, { selection: { anchor: token.close.from } }];
		}
	}
	return tr;
});

const endOfArgument = Prec.high(
	keymap.of([
		{
			key: 'End',
			run: (view) => {
				const { state } = view;
				if (!state.field(visualModeField, false)) return false;
				const cursor = state.selection.main;
				if (!cursor.empty || state.selection.ranges.length > 1) return false;
				const heading = state
					.field(tokensField)
					.find(
						(token): token is ArgumentToken =>
							token.kind === 'heading' &&
							cursor.head >= token.open.to &&
							cursor.head <= token.close.from &&
							endsLine(state, token),
					);
				if (!heading) return false;
				if (cursor.head !== heading.close.from) {
					view.dispatch({ selection: { anchor: heading.close.from } });
				}
				return true;
			},
		},
	]),
);

const visualTheme = EditorView.baseTheme({
	// Over the editor's own font, which is set for code.
	'&.cm-visual .cm-content': {
		fontFamily:
			'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif !important',
		lineHeight: '1.6',
	},
	'.cm-visual-h0': { fontSize: '1.7em', fontWeight: '700' },
	'.cm-visual-h1': { fontSize: '1.45em', fontWeight: '700' },
	'.cm-visual-h2': { fontSize: '1.25em', fontWeight: '700' },
	'.cm-visual-h3': { fontSize: '1.1em', fontWeight: '700' },
	'.cm-visual-h4': { fontWeight: '700' },
	'.cm-visual-bold': { fontWeight: '700' },
	'.cm-visual-italic': { fontStyle: 'italic' },
	'.cm-visual-underline': { textDecoration: 'underline' },
	'.cm-visual-mono': { fontFamily: 'monospace' },
	'.cm-visual-smallcaps': { fontVariant: 'small-caps' },
	'.cm-visual-caption': { fontStyle: 'italic', opacity: '0.85' },
	'.cm-visual-link': { color: '#2563eb', textDecoration: 'underline' },
	'.cm-visual-comment': { opacity: '0.55', fontStyle: 'italic' },
	'.cm-visual-env': { opacity: '0.55', fontSize: '0.85em' },
	'.cm-line.cm-visual-item': {
		paddingLeft: 'calc(var(--cm-visual-level, 1) * 1.2em + 6px)',
	},
	'.cm-visual-marker': {
		display: 'inline-block',
		minWidth: '1.4em',
		marginRight: '0.3em',
		fontWeight: '600',
		cursor: 'text',
	},
	'.cm-visual-math': { cursor: 'pointer' },
	'.cm-visual-math-display': { display: 'block', textAlign: 'center' },
	'div.cm-visual-math-display': { padding: '0.4em 0' },
	'.cm-visual-math-source': { fontFamily: 'monospace' },
	'.cm-visual-chip': {
		display: 'inline-block',
		padding: '0 0.4em',
		borderRadius: '0.35em',
		fontSize: '0.85em',
		lineHeight: '1.4',
		backgroundColor: 'rgba(37, 99, 235, 0.12)',
		color: '#1d4ed8',
		cursor: 'pointer',
	},
	'.cm-visual-chip-label': {
		backgroundColor: 'rgba(100, 116, 139, 0.15)',
		color: 'inherit',
		opacity: '0.75',
	},
	'.cm-visual-chip-label::before': { content: '"🏷 "' },
	'.cm-visual-chip-ref::before': { content: '"↗ "' },
	'.cm-visual-preamble': {
		margin: '0.2em 0',
		padding: '0.3em 0.6em',
		border: '1px dashed rgba(100, 116, 139, 0.5)',
		borderRadius: '0.35em',
		fontSize: '0.85em',
		opacity: '0.75',
		cursor: 'pointer',
	},
	'.cm-visual-title': {
		display: 'block',
		textAlign: 'center',
		padding: '0.6em 0',
		cursor: 'pointer',
	},
	'.cm-visual-title-main': { fontSize: '1.7em', fontWeight: '700' },
	'.cm-visual-title-meta': { fontSize: '1.05em', opacity: '0.85' },
	'.cm-visual-image': {
		display: 'block',
		maxWidth: '100%',
		margin: '0.3em auto',
		textAlign: 'center',
		fontSize: '0.85em',
		opacity: '0.85',
		cursor: 'pointer',
	},
	'.cm-visual-image img': { maxWidth: '100%', maxHeight: '24em' },
});

/**
 * The visual editor for LaTeX, as on Overleaf: headings, emphasis, lists,
 * formulas, references and figures shown as they will look, the preamble
 * folded, and the LaTeX of whatever the cursor is on shown for editing.
 */
export function visualLatex(initial: boolean): Extension {
	return [
		visualModeField.init(() => initial),
		tokensField,
		decorationsField,
		keepInsideArgument,
		endOfArgument,
		EditorView.editorAttributes.compute(
			[visualModeField],
			(state): Record<string, string> =>
				state.field(visualModeField) ? { class: 'cm-visual' } : {},
		),
		visualTheme,
	];
}
