// src/extensions/codemirror/SpellingExtension.ts
import {
	type EditorState,
	type Extension,
	StateEffect,
	StateField,
} from '@codemirror/state';
import {
	Decoration,
	type DecorationSet,
	EditorView,
	showTooltip,
	type Tooltip,
	type TooltipView,
	ViewPlugin,
	type ViewUpdate,
} from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';

import { t } from '@/i18n';
import { createNamedLogger } from '@/logging';
import { filePathCacheService } from '../../services/FilePathCacheService';
import { fileStoreService } from '../../services/FileStoreService';
import { spellingService } from '../../services/SpellingService';
import type { SpellingLanguage, SpellingSetting } from '../../types/spelling';
import {
	declaredLanguage,
	guessLanguage,
	interfaceSpellingLanguage,
	isProse,
	proseWords,
	type SpellingWord,
} from '../../utils/spellingUtils';

const moduleLog = createNamedLogger('SpellingExtension');

const SCAN_DELAY_MS = 250;
// Babel and polyglossia are loaded in the preamble.
const PREAMBLE_LENGTH = 20_000;
const CONTEXT_LENGTH = 6;
const WORD_CHARACTER = /[\p{L}\p{M}'’·-]/u;

export interface SpellingOptions {
	setting: SpellingSetting;
	interfaceLanguage: string;
}

interface SpellingScan {
	from: number;
	to: number;
	words: SpellingWord[];
}

interface SpellingMenu extends SpellingWord {
	language: SpellingLanguage | null;
	learned: boolean;
}

const setMisspellings = StateEffect.define<SpellingScan[]>();
const dropLearnedWords = StateEffect.define<null>();
const openSpellingMenu = StateEffect.define<SpellingMenu | null>();

const misspelling = (word: string) =>
	Decoration.mark({ class: 'cm-spelling-error', word });

const misspellingsField = StateField.define<DecorationSet>({
	create: () => Decoration.none,

	update(marks, tr) {
		let next = marks.map(tr.changes);

		// A word being edited is checked again once the edit pauses; words
		// next to the edit only when it joins letters to them.
		tr.changes.iterChanges((_fromA, _toA, fromB, toB, inserted) => {
			const text = inserted.toString();
			const joinsBefore = !text || WORD_CHARACTER.test(text[0]);
			const joinsAfter = !text || WORD_CHARACTER.test(text[text.length - 1]);
			next = next.update({
				filterFrom: fromB,
				filterTo: toB,
				filter: (from, to) =>
					(to === fromB && from < fromB && !joinsBefore) ||
					(from === toB && to > toB && !joinsAfter),
			});
		});

		for (const effect of tr.effects) {
			if (effect.is(setMisspellings)) {
				for (const scan of effect.value) {
					next = next.update({
						filterFrom: scan.from,
						filterTo: scan.to,
						filter: (from, to) => from < scan.from || to > scan.to,
						add: scan.words.map(({ from, to, word }) =>
							misspelling(word).range(from, to),
						),
						sort: true,
					});
				}
			} else if (effect.is(dropLearnedWords)) {
				next = next.update({
					filter: (_from, _to, value) =>
						!spellingService.isLearned(value.spec.word),
				});
			}
		}
		return next;
	},

	provide: (field) => EditorView.decorations.from(field),
});

const spellingMenuField = StateField.define<SpellingMenu | null>({
	create: () => null,

	update(menu, tr) {
		for (const effect of tr.effects) {
			if (effect.is(openSpellingMenu)) return effect.value;
		}
		if (!menu || !tr.docChanged) return menu;
		if (tr.changes.touchesRange(menu.from, menu.to)) return null;
		return {
			...menu,
			from: tr.changes.mapPos(menu.from),
			to: tr.changes.mapPos(menu.to),
		};
	},

	provide: (field) =>
		showTooltip.from(field, (menu): Tooltip | null =>
			menu
				? {
						pos: menu.from,
						end: menu.to,
						arrow: false,
						create: (view) => createSpellingMenu(view, menu),
					}
				: null,
		),
});

// The words to check between `from` and `to`, leaving out the one at
// `skipAt` while it is being typed.
function collectWords(
	state: EditorState,
	from: number,
	to: number,
	skipAt: number | null = null,
): SpellingWord[] {
	const words: SpellingWord[] = [];
	const sliceDoc = (start: number, end: number) => state.sliceDoc(start, end);

	syntaxTree(state).iterate({
		from,
		to,
		enter(ref) {
			if (ref.name !== 'Normal') return;
			const node = ref.node;
			if (!isProse(node, sliceDoc)) return;

			const found = proseWords(
				state.sliceDoc(node.from, node.to),
				node.from,
				state.sliceDoc(Math.max(0, node.from - CONTEXT_LENGTH), node.from),
				state.sliceDoc(node.to, node.to + CONTEXT_LENGTH),
			);
			for (const word of found) {
				if (word.to < from || word.from > to) continue;
				if (skipAt !== null && word.from <= skipAt && skipAt <= word.to) {
					continue;
				}
				words.push(word);
			}
		},
	});
	return words;
}

function createSpellingMenu(view: EditorView, menu: SpellingMenu): TooltipView {
	const dom = document.createElement('div');
	dom.className = 'cm-spelling-menu';
	dom.setAttribute('role', 'menu');
	dom.setAttribute('aria-label', t('Spelling suggestions'));
	dom.tabIndex = -1;

	const close = (focusEditor = true) => {
		if (view.state.field(spellingMenuField, false)) {
			view.dispatch({ effects: openSpellingMenu.of(null) });
		}
		if (focusEditor) view.focus();
	};

	const item = (label: string, run: () => void) => {
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'cm-spelling-menu-item';
		button.setAttribute('role', 'menuitem');
		button.tabIndex = -1;
		button.textContent = label;
		button.addEventListener('click', run);
		return button;
	};

	const items = () =>
		Array.from(dom.querySelectorAll<HTMLButtonElement>('button'));

	const replaceWith = (suggestion: string) => {
		const current = view.state.field(spellingMenuField, false);
		if (!current) return;
		view.dispatch({
			changes: { from: current.from, to: current.to, insert: suggestion },
			selection: { anchor: current.from + suggestion.length },
			effects: openSpellingMenu.of(null),
			userEvent: 'input.spelling',
		});
		view.focus();
	};

	if (menu.learned) {
		dom.append(
			item(
				t('Remove "{word}" from the dictionary', { word: menu.word }),
				() => {
					spellingService.forgetWord(menu.word);
					close();
				},
			),
		);
	} else {
		const status = document.createElement('div');
		status.className = 'cm-spelling-menu-status';
		status.textContent = t('Looking for suggestions...');
		const divider = document.createElement('hr');
		divider.className = 'cm-spelling-menu-divider';
		dom.append(
			status,
			divider,
			item(t('Add to dictionary'), () => {
				spellingService.learnWord(menu.word);
				close();
			}),
		);

		const canReplace = !view.state.readOnly && menu.language;
		if (canReplace && menu.language) {
			spellingService
				.suggest(menu.language, menu.word)
				.then((suggestions) => {
					if (!suggestions.length) {
						status.textContent = t('No suggestions');
						return;
					}
					const hadFocus = document.activeElement === dom;
					status.replaceWith(
						...suggestions.map((suggestion) => {
							const button = item(suggestion, () => replaceWith(suggestion));
							button.classList.add('cm-spelling-menu-suggestion');
							return button;
						}),
					);
					if (hadFocus) items()[0]?.focus();
				})
				.catch((error) => {
					moduleLog.warn('No spelling suggestions:', error);
					status.textContent = t('No suggestions');
				});
		} else {
			status.remove();
			divider.remove();
		}
	}

	dom.addEventListener('keydown', (event) => {
		const buttons = items();
		const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
		let target: number | null = null;
		if (event.key === 'ArrowDown') target = (index + 1) % buttons.length;
		else if (event.key === 'ArrowUp') {
			target = (index <= 0 ? buttons.length : index) - 1;
		} else if (event.key === 'Home') target = 0;
		else if (event.key === 'End') target = buttons.length - 1;
		else if (event.key === 'Escape' || event.key === 'Tab') {
			event.preventDefault();
			close();
			return;
		}
		if (target === null || !buttons.length) return;
		event.preventDefault();
		buttons[target].focus();
	});

	const closeOutside = (event: MouseEvent) => {
		if (!dom.contains(event.target as Node)) close(false);
	};

	return {
		dom,
		mount() {
			// While suggestions load, the menu itself holds the focus.
			if (dom.querySelector('.cm-spelling-menu-status')) dom.focus();
			else items()[0]?.focus();
			document.addEventListener('mousedown', closeOutside, true);
		},
		destroy() {
			document.removeEventListener('mousedown', closeOutside, true);
		},
	};
}

class SpellingPlugin {
	language: SpellingLanguage | null = null;
	private mainLanguage: SpellingLanguage | null | undefined;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private typing = false;
	private failed = false;
	private destroyed = false;
	private readonly removeListener: () => void;

	constructor(
		private readonly view: EditorView,
		private readonly options: SpellingOptions,
	) {
		this.removeListener = spellingService.addListener(() => {
			view.dispatch({ effects: dropLearnedWords.of(null) });
			this.schedule(0);
		});
		void this.loadMainLanguage();
		this.schedule(0);
	}

	update(update: ViewUpdate) {
		// Edits from collaborators leave the word being typed here alone.
		if (
			update.transactions.some(
				(tr) => tr.isUserEvent('input.type') || tr.isUserEvent('delete'),
			)
		) {
			this.typing = true;
		} else if (update.selectionSet && !update.docChanged && this.typing) {
			this.typing = false;
			this.schedule(SCAN_DELAY_MS);
		}

		if (
			update.docChanged ||
			update.viewportChanged ||
			syntaxTree(update.startState) !== syntaxTree(update.state)
		) {
			this.schedule(SCAN_DELAY_MS);
		}
	}

	destroy() {
		this.destroyed = true;
		if (this.timer) clearTimeout(this.timer);
		this.removeListener();
	}

	// The misspelled word at `pos`, or a word of the user's dictionary there.
	menuAt(state: EditorState, pos: number): SpellingMenu | null {
		let menu: SpellingMenu | null = null;
		state.field(misspellingsField).between(pos, pos, (from, to, value) => {
			menu = {
				from,
				to,
				word: value.spec.word,
				language: this.language,
				learned: false,
			};
			return false;
		});
		if (menu) return menu;

		const line = state.doc.lineAt(pos);
		const word = collectWords(state, line.from, line.to).find(
			(candidate) => candidate.from <= pos && pos <= candidate.to,
		);
		return word && spellingService.isLearned(word.word)
			? { ...word, language: this.language, learned: true }
			: null;
	}

	private schedule(delay: number) {
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => {
			this.timer = null;
			void this.scan();
		}, delay);
	}

	private async scan() {
		if (this.destroyed) return;
		const { state } = this.view;
		const language = this.resolveLanguage(state);
		this.language = language;

		const ranges = language
			? this.view.visibleRanges.map(({ from, to }) => ({
					from: state.doc.lineAt(from).from,
					to: state.doc.lineAt(to).to,
				}))
			: [{ from: 0, to: state.doc.length }];
		const skipAt = this.typing ? state.selection.main.head : null;
		const found = language
			? ranges.map(({ from, to }) => collectWords(state, from, to, skipAt))
			: ranges.map(() => []);

		if (language) {
			try {
				await spellingService.check(
					language,
					found.flat().map(({ word }) => word),
				);
				this.failed = false;
			} catch (error) {
				if (!this.failed) moduleLog.warn('Spell checking failed:', error);
				this.failed = true;
				return;
			}
		}
		// The document changed meanwhile: another scan is on its way.
		if (this.destroyed || this.view.state.doc !== state.doc) return;

		const scans = ranges.map((range, index) => ({
			...range,
			words: found[index].filter(
				({ word }) =>
					language !== null && spellingService.isMisspelled(language, word),
			),
		}));
		if (scans.every((scan) => this.shows(scan))) return;
		this.view.dispatch({ effects: setMisspellings.of(scans) });
	}

	// Whether the marks between scan.from and scan.to are already scan.words.
	private shows(scan: SpellingScan): boolean {
		const shown: SpellingWord[] = [];
		this.view.state
			.field(misspellingsField)
			.between(scan.from, scan.to, (from, to, value) => {
				if (from >= scan.from && to <= scan.to) {
					shown.push({ from, to, word: value.spec.word });
				}
			});
		return (
			shown.length === scan.words.length &&
			shown.every(
				(word, index) =>
					word.from === scan.words[index].from &&
					word.to === scan.words[index].to,
			)
		);
	}

	private resolveLanguage(state: EditorState): SpellingLanguage | null {
		const { setting, interfaceLanguage } = this.options;
		if (setting === 'off') return null;
		if (setting !== 'auto') return setting;

		const preamble = state.sliceDoc(0, PREAMBLE_LENGTH);
		const declared = declaredLanguage(preamble);
		if (declared !== undefined) return declared;
		if (this.mainLanguage !== undefined) return this.mainLanguage;
		return (
			guessLanguage(preamble) ?? interfaceSpellingLanguage(interfaceLanguage)
		);
	}

	// A file included from the main file follows the language it declares.
	private async loadMainLanguage() {
		const path = filePathCacheService.getMainFilePath();
		if (!path) return;
		try {
			const content = (await fileStoreService.getFileByPath(path))?.content;
			if (content === undefined || this.destroyed) return;
			const text =
				typeof content === 'string'
					? content
					: new TextDecoder().decode(content);
			this.mainLanguage = declaredLanguage(text.slice(0, PREAMBLE_LENGTH));
			if (this.mainLanguage !== undefined) this.schedule(0);
		} catch (error) {
			moduleLog.warn('Could not read the main file language:', error);
		}
	}
}

// Underlines misspelled words in LaTeX prose, leaving commands, math,
// labels and references alone; a right-click on a word offers suggestions.
export function createSpellingExtension(options: SpellingOptions): Extension {
	if (options.setting === 'off') return [];

	const plugin = ViewPlugin.define((view) => new SpellingPlugin(view, options));

	return [
		misspellingsField,
		spellingMenuField,
		plugin,
		EditorView.domEventHandlers({
			contextmenu(event, view) {
				const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
				const menu =
					pos === null ? null : view.plugin(plugin)?.menuAt(view.state, pos);
				if (!menu) return false;
				event.preventDefault();
				view.dispatch({ effects: openSpellingMenu.of(menu) });
				return true;
			},
		}),
	];
}
