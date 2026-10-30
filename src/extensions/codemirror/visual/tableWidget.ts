// src/extensions/codemirror/visual/tableWidget.ts
// Tables in the visual editor, as Overleaf's table editor shows them: a
// grid whose cells are selected with a click, the arrows or Tab, edited with
// a double click, Enter or by typing, and changed with a small toolbar
// (rows, columns, alignment, borders). Each edit changes only the LaTeX it
// concerns, read again from the document at that moment, so that the edits
// of collaborators in the meantime are kept.
import { isolateHistory } from '@codemirror/commands';
import { StateEffect, StateField } from '@codemirror/state';
import {
	type EditorView,
	WidgetType,
	runScopeHandlers,
} from '@codemirror/view';
import katex from 'katex';

import { t } from '@/i18n';
import { stripAnnotationTags } from '../../../utils/annotationTagUtils';
import { separateUndoStep } from '../undoSteps';
import {
	type LatexTable,
	type TableChange,
	cellAt,
	deleteColumn,
	deleteRow,
	insertColumn,
	insertRow,
	parseLatexTable,
	setBorders,
	setCell,
	setColumnAlign,
} from './latexTable';
import { matchBrace } from './visualTokens';

/** The selected cell of a table, the table known by where it starts. */
export interface TableSelection {
	at: number;
	row: number;
	col: number;
	editing: boolean;
	/** What typing a key to start editing put in the cell. */
	typed?: string;
}

export const selectTableCell = StateEffect.define<TableSelection | null>();

export const tableSelectionField = StateField.define<TableSelection | null>({
	create: () => null,
	update(value, tr) {
		for (const effect of tr.effects) {
			if (effect.is(selectTableCell)) return effect.value;
		}
		if (!value) return value;
		// Moving the cursor in the text leaves the table.
		if (tr.selection) return null;
		return tr.docChanged
			? { ...value, at: tr.changes.mapPos(value.at, -1) }
			: value;
	},
});

// What is typed in a cell, kept if the table is drawn again meanwhile.
const drafts = new WeakMap<
	EditorView,
	{ at: number; row: number; col: number; value: string }
>();

// The table at `at` as the document has it now.
const currentTable = (view: EditorView, at: number): LatexTable | null =>
	parseLatexTable(view.state.doc.toString(), at);

// Keys go to the cell being edited, or else to the table with a selected
// cell, as soon as it is drawn, so that fast typing is not lost.
const focusTable = (view: EditorView): boolean => {
	const input = view.dom.querySelector<HTMLInputElement>(
		'.cm-visual-table input.cm-visual-cell-input',
	);
	const grid = view.dom
		.querySelector('.cm-visual-table td.cm-visual-cell-selected')
		?.closest('table');
	const target = input ?? grid;
	if (!target) return false;
	if (document.activeElement !== target) {
		target.focus({ preventScroll: true });
		if (input) input.setSelectionRange(input.value.length, input.value.length);
	}
	return true;
};

const select = (view: EditorView, selection: TableSelection | null) => {
	view.dispatch({ effects: selectTableCell.of(selection) });
	if (selection) focusTable(view);
};

const apply = (
	view: EditorView,
	changes: TableChange[],
	selection: TableSelection | null,
) => {
	// Each edit of the table is undone on its own.
	separateUndoStep(view);
	view.dispatch({
		changes,
		effects: selectTableCell.of(selection),
		annotations: isolateHistory.of('full'),
		userEvent: 'input',
	});
	separateUndoStep(view);
	if (selection) focusTable(view);
	else view.focus();
};

// The cell content as it will look: formatting, formulas and escapes.
const FORMAT_TAGS: Record<string, string> = {
	textbf: 'strong',
	textit: 'em',
	emph: 'em',
	textsl: 'em',
	underline: 'u',
	texttt: 'code',
	textsc: 'span',
};
const SYMBOLS: Record<string, string> = {
	ldots: '…',
	dots: '…',
	textendash: '–',
	textemdash: '—',
	LaTeX: 'LaTeX',
	TeX: 'TeX',
	degree: '°',
	textdegree: '°',
	pm: '±',
	times: '×',
};

const renderMath = (tex: string, into: Node) => {
	const span = document.createElement('span');
	span.className = 'cm-visual-math';
	katex.render(tex || '\\square', span, {
		throwOnError: false,
		output: 'html',
		strict: 'ignore',
	});
	into.appendChild(span);
};

export const renderCellContent = (source: string, into: HTMLElement): void => {
	const text = stripAnnotationTags(source);
	const render = (from: number, to: number, parent: Node) => {
		let buffer = '';
		const flush = () => {
			if (buffer) parent.appendChild(document.createTextNode(buffer));
			buffer = '';
		};
		let i = from;
		while (i < to) {
			const char = text[i];
			if (char === '%') {
				const end = text.indexOf('\n', i);
				i = end === -1 || end > to ? to : end;
			} else if (char === '$') {
				const end = text.indexOf('$', i + 1);
				if (end === -1 || end >= to) {
					buffer += char;
					i++;
					continue;
				}
				flush();
				renderMath(text.slice(i + 1, end), parent);
				i = end + 1;
			} else if (char === '~') {
				buffer += ' ';
				i++;
			} else if (char === '{' || char === '}') {
				i++;
			} else if (char !== '\\') {
				buffer += char;
				i++;
			} else {
				const next = text[i + 1] ?? '';
				if (next === '\\') {
					flush();
					parent.appendChild(document.createElement('br'));
					i += 2;
				} else if (next === '(') {
					const end = text.indexOf('\\)', i + 2);
					if (end === -1 || end >= to) {
						i += 2;
						continue;
					}
					flush();
					renderMath(text.slice(i + 2, end), parent);
					i = end + 2;
				} else if ('%&_$#{}'.includes(next) && next) {
					buffer += next;
					i += 2;
				} else if (',;:'.includes(next) && next) {
					buffer += ' ';
					i += 2;
				} else {
					const name = /^[a-zA-Z@]+/.exec(text.slice(i + 1, i + 40))?.[0];
					if (!name) {
						i += 2;
						continue;
					}
					let after = i + 1 + name.length;
					if (name in SYMBOLS) {
						buffer += SYMBOLS[name];
						i = after;
						continue;
					}
					while (text[after] === ' ') after++;
					// \multicolumn{n}{spec}{text}, \multirow{n}{width}{text}:
					// the text only.
					if (name === 'multicolumn' || name === 'multirow') {
						for (let skip = 0; skip < 2 && text[after] === '{'; skip++) {
							after = matchBrace(text, after) + 1;
							if (after === 0) break;
							while (text[after] === ' ') after++;
						}
						i = after;
						continue;
					}
					const tag = FORMAT_TAGS[name];
					if (tag && text[after] === '{') {
						const close = matchBrace(text, after);
						if (close !== -1 && close <= to) {
							flush();
							const element = document.createElement(tag);
							if (name === 'textsc') element.style.fontVariant = 'small-caps';
							render(after + 1, close, element);
							parent.appendChild(element);
							i = close + 1;
							continue;
						}
					}
					// Other commands: their arguments show as text.
					i = i + 1 + name.length;
				}
			}
		}
		flush();
	};
	render(0, text.length, into);
};

const ALIGN: Record<string, string> = {
	l: 'left',
	c: 'center',
	r: 'right',
	p: 'left',
};

// Toolbar actions on the selected cell.
type Action =
	| 'row-above'
	| 'row-below'
	| 'col-left'
	| 'col-right'
	| 'delete-row'
	| 'delete-col'
	| 'align-l'
	| 'align-c'
	| 'align-r'
	| 'borders-all'
	| 'borders-none'
	| 'latex';

const runAction = (
	view: EditorView,
	selection: TableSelection,
	action: Action,
) => {
	const text = view.state.doc.toString();
	const table = currentTable(view, selection.at);
	if (!table) return;
	const { row, col } = selection;
	const keep = (next: Partial<TableSelection> = {}) => ({
		...selection,
		editing: false,
		typed: undefined,
		...next,
	});
	switch (action) {
		case 'row-above':
			return apply(
				view,
				insertRow(text, table, row, 'above'),
				keep({ row: row }),
			);
		case 'row-below':
			return apply(
				view,
				insertRow(text, table, row, 'below'),
				keep({ row: row + 1 }),
			);
		case 'col-left':
			return apply(view, insertColumn(table, col, 'left'), keep());
		case 'col-right':
			return apply(
				view,
				insertColumn(table, col, 'right'),
				keep({ col: col + 1 }),
			);
		case 'delete-row':
			return apply(
				view,
				deleteRow(text, table, row),
				keep({ row: Math.max(0, Math.min(row, table.rows.length - 2)) }),
			);
		case 'delete-col':
			return apply(
				view,
				deleteColumn(table, col),
				keep({ col: Math.max(0, Math.min(col, table.columns.length - 2)) }),
			);
		case 'align-l':
		case 'align-c':
		case 'align-r':
			return apply(
				view,
				setColumnAlign(table, col, action.slice(-1) as 'l' | 'c' | 'r'),
				keep(),
			);
		case 'borders-all':
		case 'borders-none':
			return apply(
				view,
				setBorders(text, table, action === 'borders-all' ? 'all' : 'none'),
				keep(),
			);
		case 'latex': {
			// The cursor in the cell shows the table's LaTeX.
			const found = table.rows[row] && cellAt(table.rows[row], col);
			const anchor = found ? found.cell.contentFrom : table.from;
			view.dispatch({
				selection: { anchor },
				effects: selectTableCell.of(null),
				scrollIntoView: true,
			});
			view.focus();
		}
	}
};

const button = (
	label: string,
	title: string,
	action: Action,
	pressed?: boolean,
): HTMLButtonElement => {
	const element = document.createElement('button');
	element.type = 'button';
	element.textContent = label;
	element.title = title;
	element.setAttribute('aria-label', title);
	element.dataset.action = action;
	if (pressed !== undefined)
		element.setAttribute('aria-pressed', String(pressed));
	return element;
};

const menu = (
	label: string,
	options: Array<[Action, string]>,
): HTMLSelectElement => {
	const select = document.createElement('select');
	select.title = label;
	select.setAttribute('aria-label', label);
	const placeholder = document.createElement('option');
	placeholder.value = '';
	placeholder.textContent = label;
	select.appendChild(placeholder);
	for (const [action, text] of options) {
		const option = document.createElement('option');
		option.value = action;
		option.textContent = text;
		select.appendChild(option);
	}
	return select;
};

export class TableWidget extends WidgetType {
	constructor(
		readonly source: string,
		readonly table: LatexTable,
		readonly selection: TableSelection | null,
		readonly editable: boolean,
	) {
		super();
	}

	eq(other: TableWidget) {
		return (
			other.source === this.source &&
			other.editable === this.editable &&
			JSON.stringify(other.selection) === JSON.stringify(this.selection)
		);
	}

	toDOM(view: EditorView) {
		const { table, selection, editable } = this;
		const dom = document.createElement('div');
		dom.className = 'cm-visual-table';
		dom.dataset.role = 'visual-table';

		if (selection && editable) dom.appendChild(this.toolbar(view, selection));

		const grid = document.createElement('table');
		grid.tabIndex = -1;
		const columns = table.columns.length;
		for (const [rowIndex, row] of table.rows.entries()) {
			const line = document.createElement('tr');
			let col = 0;
			const cells = [...row.cells];
			for (const cell of cells) {
				if (col >= columns) break;
				const span = Math.min(cell.span, columns - col);
				const td = this.cell(rowIndex, col, span, cell.align);
				const selected =
					selection?.row === rowIndex &&
					selection.col >= col &&
					selection.col < col + span;
				if (selected && selection.editing && editable) {
					this.editor(view, selection, cell.source, td);
				} else {
					renderCellContent(cell.source, td);
				}
				if (selected) td.classList.add('cm-visual-cell-selected');
				line.appendChild(td);
				col += span;
			}
			// Cells the row lacks.
			for (; col < columns; col++) {
				const td = this.cell(rowIndex, col, 1, undefined);
				if (selection?.row === rowIndex && selection.col === col) {
					td.classList.add('cm-visual-cell-selected');
					if (selection.editing && editable) {
						this.editor(view, selection, '', td);
					}
				}
				line.appendChild(td);
			}
			grid.appendChild(line);
		}
		dom.appendChild(grid);

		this.listen(view, dom, grid);
		if (selection) {
			// Once drawn, keys go to the table, or to the cell being edited.
			requestAnimationFrame(() => {
				if (!dom.isConnected) return;
				// Not when the person went on elsewhere, as in the chat.
				const active = document.activeElement;
				if (active && active !== document.body && !view.dom.contains(active)) {
					return;
				}
				focusTable(view);
			});
		}
		return dom;
	}

	private cell(
		row: number,
		col: number,
		span: number,
		align: string | undefined,
	): HTMLTableCellElement {
		const { table } = this;
		const td = document.createElement('td');
		td.dataset.row = String(row);
		td.dataset.col = String(col);
		if (span > 1) td.colSpan = span;
		td.style.textAlign = ALIGN[align ?? table.columns[col]?.align ?? 'l'];
		const classes = ['cm-visual-cell'];
		if (table.rows[row].ruleAbove) classes.push('cm-visual-rule-top');
		if (row === table.rows.length - 1 && table.ruleBelow) {
			classes.push('cm-visual-rule-bottom');
		}
		if (table.verticalRules[col] > 0) classes.push('cm-visual-rule-left');
		if (table.verticalRules[col + span] > 0)
			classes.push('cm-visual-rule-right');
		td.className = classes.join(' ');
		return td;
	}

	private editor(
		view: EditorView,
		selection: TableSelection,
		source: string,
		td: HTMLTableCellElement,
	): HTMLInputElement {
		const input = document.createElement('input');
		input.type = 'text';
		input.className = 'cm-visual-cell-input';
		input.setAttribute('aria-label', t('Cell'));
		const draft = drafts.get(view);
		input.value =
			draft &&
			draft.at === selection.at &&
			draft.row === selection.row &&
			draft.col === selection.col
				? draft.value
				: (selection.typed ?? source);
		drafts.set(view, { ...selection, value: input.value });
		input.addEventListener('input', () => {
			drafts.set(view, { ...selection, value: input.value });
		});
		let done = false;
		const commit = (next: Partial<TableSelection> | null) => {
			if (done) return;
			done = true;
			drafts.delete(view);
			const table = currentTable(view, selection.at);
			const changes = table
				? setCell(
						view.state.doc.toString(),
						table,
						selection.row,
						selection.col,
						input.value,
					)
				: [];
			apply(
				view,
				changes,
				next === null
					? null
					: { ...selection, editing: false, typed: undefined, ...next },
			);
		};
		input.addEventListener('keydown', (event) => {
			event.stopPropagation();
			if (event.key === 'Enter') {
				event.preventDefault();
				commit({});
			} else if (event.key === 'Tab') {
				event.preventDefault();
				commit(this.step(selection, event.shiftKey ? -1 : 1));
			} else if (event.key === 'Escape') {
				event.preventDefault();
				done = true;
				drafts.delete(view);
				select(view, { ...selection, editing: false, typed: undefined });
			}
		});
		input.addEventListener('blur', () => {
			// Drawn again (a collaborator's edit), the draft lives on.
			setTimeout(() => {
				if (!input.isConnected || done) return;
				const inTable = document.activeElement?.closest('.cm-visual-table');
				commit(inTable ? {} : null);
			});
		});
		td.appendChild(input);
		return input;
	}

	// The next or previous cell, row after row.
	private step(selection: TableSelection, by: 1 | -1): Partial<TableSelection> {
		const { table } = this;
		const columns = table.columns.length;
		const row = table.rows[selection.row];
		const found = row && cellAt(row, selection.col);
		let col =
			by > 0
				? found
					? found.start + found.cell.span
					: selection.col + 1
				: found
					? found.start - 1
					: selection.col - 1;
		let rowIndex = selection.row;
		if (col >= columns) {
			if (rowIndex >= table.rows.length - 1) return { col: selection.col };
			rowIndex++;
			col = 0;
		} else if (col < 0) {
			if (rowIndex === 0) return { col: selection.col };
			rowIndex--;
			col = columns - 1;
		}
		const target = table.rows[rowIndex] && cellAt(table.rows[rowIndex], col);
		return { row: rowIndex, col: target ? target.start : col };
	}

	private toolbar(view: EditorView, selection: TableSelection): HTMLElement {
		const { table } = this;
		const bar = document.createElement('div');
		bar.className = 'cm-visual-table-toolbar';
		bar.dataset.role = 'visual-table-toolbar';
		const align = table.columns[selection.col]?.align;
		bar.append(
			menu(t('Insert'), [
				['row-above', t('Row above')],
				['row-below', t('Row below')],
				['col-left', t('Column left')],
				['col-right', t('Column right')],
			]),
			menu(t('Delete'), [
				['delete-row', t('Delete row')],
				['delete-col', t('Delete column')],
			]),
			button('⇤', t('Align left'), 'align-l', align === 'l'),
			button('↔', t('Align center'), 'align-c', align === 'c'),
			button('⇥', t('Align right'), 'align-r', align === 'r'),
			menu(t('Borders'), [
				['borders-all', t('All borders')],
				['borders-none', t('No borders')],
			]),
			button(t('LaTeX'), t('Edit the LaTeX of the table'), 'latex'),
		);
		bar.addEventListener('change', (event) => {
			const select = event.target as HTMLSelectElement;
			const action = select.value as Action;
			select.value = '';
			if (action) runAction(view, selection, action);
		});
		bar.addEventListener('click', (event) => {
			const target = (event.target as HTMLElement).closest('button');
			if (target?.dataset.action) {
				runAction(view, selection, target.dataset.action as Action);
			}
		});
		return bar;
	}

	private listen(view: EditorView, dom: HTMLElement, grid: HTMLElement) {
		const { editable } = this;
		const choose = (next: Partial<TableSelection>) => {
			const current = this.selection;
			const at = current?.at ?? this.locate(view, dom);
			if (at === null) return;
			select(view, {
				at,
				row: current?.row ?? 0,
				col: current?.col ?? 0,
				editing: false,
				...next,
			});
		};
		grid.addEventListener('mousedown', (event) => {
			const td = (event.target as HTMLElement).closest('td');
			if (!td || (event.target as HTMLElement).closest('input')) return;
			event.preventDefault();
			grid.focus({ preventScroll: true });
			if (!editable) return;
			choose({ row: Number(td.dataset.row), col: Number(td.dataset.col) });
		});
		grid.addEventListener('dblclick', (event) => {
			const td = (event.target as HTMLElement).closest('td');
			if (!td || !editable) return;
			choose({
				row: Number(td.dataset.row),
				col: Number(td.dataset.col),
				editing: true,
			});
		});
		grid.addEventListener('keydown', (event) => {
			const selection = this.selection;
			if (!selection || !editable) return;
			const mod = event.ctrlKey || event.metaKey;
			const move = (row: number, col: number) => {
				event.preventDefault();
				const rows = this.table.rows.length;
				const nextRow = Math.max(0, Math.min(rows - 1, row));
				const target = cellAt(
					this.table.rows[nextRow],
					Math.max(0, Math.min(this.table.columns.length - 1, col)),
				);
				choose({ row: nextRow, col: target ? target.start : Math.max(0, col) });
			};
			const found = cellAt(this.table.rows[selection.row], selection.col);
			const start = found?.start ?? selection.col;
			const end = found ? found.start + found.cell.span : selection.col + 1;
			if (mod && /^[zy]$/i.test(event.key)) {
				// Undo and redo, as in the text.
				if (runScopeHandlers(view, event, 'editor')) event.preventDefault();
				return;
			}
			if (mod || event.altKey) return;
			switch (event.key) {
				case 'ArrowUp':
					return move(selection.row - 1, selection.col);
				case 'ArrowDown':
					return move(selection.row + 1, selection.col);
				case 'ArrowLeft':
					return move(selection.row, start - 1);
				case 'ArrowRight':
					return end < this.table.columns.length
						? move(selection.row, end)
						: event.preventDefault();
				case 'Tab':
					event.preventDefault();
					return choose(this.step(selection, event.shiftKey ? -1 : 1));
				case 'Enter':
				case 'F2':
					event.preventDefault();
					return choose({ editing: true, typed: undefined });
				case 'Escape':
					event.preventDefault();
					view.dispatch({ effects: selectTableCell.of(null) });
					view.focus();
					return;
				case 'Backspace':
				case 'Delete': {
					event.preventDefault();
					const table = currentTable(view, selection.at);
					if (!table) return;
					apply(
						view,
						setCell(
							view.state.doc.toString(),
							table,
							selection.row,
							selection.col,
							'',
						),
						selection,
					);
					return;
				}
				default:
					if (event.key.length === 1) {
						event.preventDefault();
						choose({ editing: true, typed: event.key });
					}
			}
		});
	}

	// Where the table starts, from where its widget is drawn.
	private locate(view: EditorView, dom: HTMLElement): number | null {
		const pos = view.posAtDOM(dom);
		const text = view.state.doc.toString();
		const at = text.indexOf('\\begin', pos);
		return at !== -1 && parseLatexTable(text, at) ? at : null;
	}

	ignoreEvent() {
		return true;
	}
}
