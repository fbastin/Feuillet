// src/extensions/codemirror/editorContextMenu.ts
// The editor's right-click menu, as Overleaf's: cut, copy, paste and select
// all; going to the place in the PDF (SyncTeX); commenting the selection;
// accepting or rejecting the tracked changes it holds; turning one's track
// changes on or off. A right-click outside the selection first puts the
// cursor there. Shift+right-click keeps the browser's own menu, and a
// misspelt word its suggestions (SpellingExtension, which comes first).
import { selectAll } from '@codemirror/commands';
import { EditorSelection, type Extension, Prec } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';

import { t } from '@/i18n';
import { TOGGLE_TRACK_CHANGES } from './overleafKeys';
import {
	decideReviewsById,
	getReviewChunks,
	reviewConfig,
} from './ReviewExtension';
import { changesIn } from './review/reviewTooltip';

/**
 * Asked before showing « Jump to location in PDF »: an editor whose PDF
 * can be reached sets `detail.available` (Editor.tsx).
 */
export const SOURCEMAP_QUERY = 'sourcemap-available-query';

interface ContextMenuOptions {
	/** Whether this person may comment here. */
	comments: boolean;
	/** Whether this file has tracked changes. */
	reviews: boolean;
}

type MenuItem =
	| {
			action: string;
			label: string;
			keys?: string;
			checked?: boolean;
			run: (menu: OpenMenu) => void | Promise<void>;
	  }
	| 'divider';

interface OpenMenu {
	dom: HTMLElement;
	close: (focusEditor?: boolean) => void;
	say: (message: string) => void;
}

const isMac =
	typeof navigator !== 'undefined' &&
	/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

// Ctrl+Shift+C as written on this machine: ⇧⌘C on a Mac.
const keysLabel = (keys: string) =>
	isMac ? keys.replace('Ctrl+', '⌘').replace(/^(⌘)Shift\+/, '⇧$1') : keys;

const sourceMapAvailable = () => {
	const query = new CustomEvent<{ available: boolean }>(SOURCEMAP_QUERY, {
		detail: { available: false },
	});
	document.dispatchEvent(query);
	return query.detail.available;
};

// What the browser's own commands do with the editor's selection, through
// CodeMirror's copy and cut handlers (comment and review tags left out).
const clipboardCommand = (view: EditorView, command: 'copy' | 'cut') => {
	view.focus();
	let done = false;
	try {
		done = document.execCommand(command);
	} catch {
		done = false;
	}
	if (done) return;
	const { from, to } = view.state.selection.main;
	void navigator.clipboard?.writeText(view.state.sliceDoc(from, to));
	if (command === 'cut' && !view.state.readOnly) {
		view.dispatch({
			changes: { from, to },
			userEvent: 'delete.cut',
			scrollIntoView: true,
		});
	}
};

function menuItems(view: EditorView, options: ContextMenuOptions): MenuItem[] {
	const { state } = view;
	const selection = state.selection.main;
	const hasSelection = !selection.empty;
	const editable = !state.readOnly;
	const items: MenuItem[] = [];

	if (editable && hasSelection) {
		items.push({
			action: 'cut',
			label: t('Cut'),
			keys: 'Ctrl+X',
			run: () => clipboardCommand(view, 'cut'),
		});
	}
	if (hasSelection) {
		items.push({
			action: 'copy',
			label: t('Copy'),
			keys: 'Ctrl+C',
			run: () => clipboardCommand(view, 'copy'),
		});
	}
	if (editable) {
		items.push({
			action: 'paste',
			label: t('Paste'),
			keys: 'Ctrl+V',
			run: async (menu) => {
				let text: string | undefined;
				try {
					text = await navigator.clipboard.readText();
				} catch {
					text = undefined;
				}
				if (text === undefined) {
					menu.say(
						t(
							'The browser did not let this menu read the clipboard: paste with {keys}',
							{
								keys: keysLabel('Ctrl+V'),
							},
						),
					);
					return;
				}
				menu.close();
				if (!text) return;
				view.dispatch({
					...view.state.replaceSelection(text),
					userEvent: 'input.paste',
					scrollIntoView: true,
				});
			},
		});
	}
	items.push({
		action: 'select-all',
		label: t('Select all'),
		keys: 'Ctrl+A',
		run: () => {
			selectAll(view);
		},
	});

	if (sourceMapAvailable()) {
		items.push('divider', {
			action: 'jump-to-pdf',
			label: t('Jump to location in PDF'),
			run: () => {
				document.dispatchEvent(new CustomEvent('trigger-sourcemap-forward'));
			},
		});
	}

	const review = options.reviews ? state.field(reviewConfig, false) : undefined;
	const changes =
		review?.canDecide && hasSelection
			? changesIn(getReviewChunks(state), selection.from, selection.to)
			: [];
	const commenting = options.comments && hasSelection;
	if (commenting || changes.length || review?.canDecide) items.push('divider');
	if (commenting) {
		items.push({
			action: 'comment',
			label: t('Add comment'),
			keys: 'Ctrl+Shift+C',
			run: () => {
				document.dispatchEvent(
					new CustomEvent('show-comment-modal', {
						detail: { selection: { from: selection.from, to: selection.to } },
					}),
				);
			},
		});
	}
	if (changes.length) {
		const ids = changes.map((change) => change.id);
		const count = ids.length;
		items.push(
			{
				action: 'accept-selected',
				label:
					count === 1
						? t('Accept the change in the selection')
						: t('Accept the {number} changes in the selection', {
								number: count,
							}),
				run: () => {
					decideReviewsById(view, ids, true);
				},
			},
			{
				action: 'reject-selected',
				label:
					count === 1
						? t('Reject the change in the selection')
						: t('Reject the {number} changes in the selection', {
								number: count,
							}),
				run: () => {
					decideReviewsById(view, ids, false);
				},
			},
		);
	}
	// Those who may decide may also stop tracking their own changes; a
	// reviewer's are always tracked.
	if (review?.canDecide && editable) {
		items.push({
			action: 'track-changes',
			label: t('Turn track changes on or off'),
			keys: 'Ctrl+Shift+A',
			checked: review.tracking,
			run: () => {
				document.dispatchEvent(new CustomEvent(TOGGLE_TRACK_CHANGES));
			},
		});
	}
	return items;
}

const menuPlugin = (options: ContextMenuOptions) =>
	ViewPlugin.fromClass(
		class {
			menu: OpenMenu | null = null;

			constructor(readonly view: EditorView) {}

			open(x: number, y: number) {
				this.menu?.close(false);
				const view = this.view;
				const dom = document.createElement('div');
				dom.className = 'cm-context-menu';
				dom.setAttribute('role', 'menu');
				dom.setAttribute('aria-label', t('Editor menu'));
				dom.dataset.role = 'editor-context-menu';
				dom.tabIndex = -1;

				const status = document.createElement('div');
				status.className = 'cm-context-menu-status';
				status.setAttribute('role', 'status');
				status.hidden = true;

				const cleanups: Array<() => void> = [];
				const listen = (
					target: Window | Document | HTMLElement,
					type: string,
					handler: (event: Event) => void,
					capture = false,
				) => {
					target.addEventListener(type, handler, capture);
					cleanups.push(() =>
						target.removeEventListener(type, handler, capture),
					);
				};

				const menu: OpenMenu = {
					dom,
					close: (focusEditor = true) => {
						if (this.menu !== menu) return;
						this.menu = null;
						for (const cleanup of cleanups) cleanup();
						dom.remove();
						if (focusEditor) view.focus();
					},
					say: (message) => {
						status.textContent = message;
						status.hidden = false;
					},
				};
				this.menu = menu;

				for (const item of menuItems(view, options)) {
					if (item === 'divider') {
						const divider = document.createElement('hr');
						divider.className = 'cm-context-menu-divider';
						dom.append(divider);
						continue;
					}
					const button = document.createElement('button');
					button.type = 'button';
					button.className = 'cm-context-menu-item';
					button.dataset.action = item.action;
					button.tabIndex = -1;
					if (item.checked === undefined) {
						button.setAttribute('role', 'menuitem');
					} else {
						button.setAttribute('role', 'menuitemcheckbox');
						button.setAttribute('aria-checked', String(item.checked));
					}
					const check = document.createElement('span');
					check.className = 'cm-context-menu-check';
					check.setAttribute('aria-hidden', 'true');
					check.textContent = item.checked ? '✓' : '';
					const label = document.createElement('span');
					label.className = 'cm-context-menu-label';
					label.textContent = item.label;
					button.append(check, label);
					if (item.keys) {
						const keys = document.createElement('kbd');
						keys.className = 'cm-context-menu-keys';
						keys.textContent = keysLabel(item.keys);
						button.append(keys);
					}
					button.addEventListener('click', async () => {
						if (item.action === 'paste') {
							await item.run(menu);
							return;
						}
						menu.close();
						await item.run(menu);
					});
					dom.append(button);
				}
				dom.append(status);

				const buttons = () =>
					Array.from(dom.querySelectorAll<HTMLButtonElement>('button'));
				listen(dom, 'keydown', (event) => {
					const key = (event as KeyboardEvent).key;
					const list = buttons();
					const at = list.indexOf(document.activeElement as HTMLButtonElement);
					const move = (index: number) => {
						event.preventDefault();
						list[(index + list.length) % list.length]?.focus();
					};
					if (key === 'ArrowDown') move(at + 1);
					else if (key === 'ArrowUp') move(at < 0 ? -1 : at - 1);
					else if (key === 'Home') move(0);
					else if (key === 'End') move(-1);
					else if (key === 'Escape' || key === 'Tab') {
						event.preventDefault();
						menu.close();
					}
				});
				// Anywhere else, or the page moving under it, closes it.
				listen(
					document,
					'mousedown',
					(event) => {
						if (!dom.contains(event.target as Node)) menu.close(false);
					},
					true,
				);
				listen(view.scrollDOM, 'scroll', () => menu.close(false));
				listen(window, 'resize', () => menu.close(false));
				listen(window, 'blur', () => menu.close(false));

				// On the page itself: inside the editor, a pane would clip it.
				document.body.append(dom);
				// At the pointer, kept on the screen.
				const box = dom.getBoundingClientRect();
				const left = Math.max(
					4,
					Math.min(x, window.innerWidth - box.width - 4),
				);
				const top =
					y + box.height + 4 > window.innerHeight
						? Math.max(4, y - box.height)
						: y;
				dom.style.left = `${left}px`;
				dom.style.top = `${top}px`;
				dom.focus();
			}

			destroy() {
				this.menu?.close(false);
			}
		},
	);

export function editorContextMenu(options: ContextMenuOptions): Extension {
	const plugin = menuPlugin(options);
	return [
		plugin,
		Prec.lowest(
			EditorView.domEventHandlers({
				contextmenu(event, view) {
					if (event.shiftKey) return false;
					const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
					const { from, to } = view.state.selection.main;
					if (pos !== null && (pos < from || pos > to || from === to)) {
						view.dispatch({ selection: EditorSelection.cursor(pos) });
					}
					event.preventDefault();
					view.plugin(plugin)?.open(event.clientX, event.clientY);
					return true;
				},
			}),
		),
	];
}
