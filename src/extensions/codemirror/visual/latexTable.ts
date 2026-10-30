// src/extensions/codemirror/visual/latexTable.ts
// Tables of a LaTeX document, as the visual editor shows and edits them:
// a tabular environment read into columns, rows and cells with their places
// in the text, and the changes that edit them as Overleaf's table editor
// does. Pure text in, positions and changes out, so that it can be tested
// without an editor.

import { matchBrace } from './visualTokens';

export type ColumnAlign = 'l' | 'c' | 'r' | 'p';

export interface TableColumn {
	align: ColumnAlign;
	/** The column in the column specification, e.g. `c` or `p{3cm}`. */
	spec: string;
}

export interface TableCell {
	/** The text between the separators around the cell. */
	from: number;
	to: number;
	/** The cell's LaTeX without the spaces around it; empty cells have
	 * from === to, at the end of their spaces. */
	contentFrom: number;
	contentTo: number;
	source: string;
	/** Columns taken by the cell (\multicolumn). */
	span: number;
	/** The alignment a \multicolumn gives the cell. */
	align?: ColumnAlign;
}

export interface TableRow {
	/** Where the rules above the row start, or the row itself. */
	ruleFrom: number;
	/** Where the row's first cell starts, after its rules. */
	contentFrom: number;
	/** After the row's \\ (and its optional [space]), or its last cell. */
	to: number;
	/** Whether the row ends with \\. */
	ended: boolean;
	ruleAbove: boolean;
	cells: TableCell[];
}

export interface LatexTable {
	env: string;
	/** \begin{tabular} to the end of \end{tabular}. */
	from: number;
	to: number;
	/** The column specification, inside its braces. */
	specFrom: number;
	specTo: number;
	columns: TableColumn[];
	/** Vertical rules at each column boundary: columns.length + 1 counts. */
	verticalRules: number[];
	bodyFrom: number;
	bodyTo: number;
	rows: TableRow[];
	/** Whether a rule follows the last row. */
	ruleBelow: boolean;
	/** Where the rules after the last row start. */
	trailingFrom: number;
	/** The indentation of the rows. */
	indent: string;
}

export interface TableChange {
	from: number;
	to: number;
	insert: string;
}

const TABLE_ENVS = new Set(['tabular', 'tabular*', 'tabularx']);
// Environments whose width comes before the column specification.
const WIDTH_ENVS = new Set(['tabular*', 'tabularx']);
const RULE = /^\\(hline|toprule|midrule|bottomrule|cline|cmidrule)\b/;
// How far a table may reach, so that a typo does not swallow the rest of
// the document.
const MAX_TABLE = 50000;

const lineStart = (text: string, pos: number) =>
	text.lastIndexOf('\n', pos - 1) + 1;
const lineEnd = (text: string, pos: number) => {
	const end = text.indexOf('\n', pos);
	return end === -1 ? text.length : end;
};
const isSpace = (char: string | undefined) =>
	char === ' ' || char === '\t' || char === '\n' || char === '\r';

// Past spaces and comments.
const skipBlank = (text: string, pos: number, end: number): number => {
	let i = pos;
	while (i < end) {
		if (isSpace(text[i])) i++;
		else if (text[i] === '%') i = lineEnd(text, i);
		else break;
	}
	return i;
};

// Past an optional argument [...] at `pos`, or `pos`.
const skipBracket = (text: string, pos: number): number => {
	if (text[pos] !== '[') return pos;
	const close = text.indexOf(']', pos);
	return close === -1 ? pos : close + 1;
};

/** Reads a column specification; null for what the editor does not handle. */
export const parseColumnSpec = (
	spec: string,
): { columns: TableColumn[]; verticalRules: number[] } | null => {
	const columns: TableColumn[] = [];
	const verticalRules = [0];
	let i = 0;
	while (i < spec.length) {
		const char = spec[i];
		if (isSpace(char)) {
			i++;
		} else if (char === '|') {
			verticalRules[verticalRules.length - 1]++;
			i++;
		} else if (char === 'l' || char === 'c' || char === 'r' || char === 'X') {
			columns.push({ align: char === 'X' ? 'p' : char, spec: char });
			verticalRules.push(0);
			i++;
		} else if (char === 'p' || char === 'm' || char === 'b') {
			const close = spec[i + 1] === '{' ? matchBrace(spec, i + 1) : -1;
			if (close === -1) return null;
			columns.push({ align: 'p', spec: spec.slice(i, close + 1) });
			verticalRules.push(0);
			i = close + 1;
		} else if (char === '*') {
			// *{3}{c}: the columns, repeated.
			const countClose = spec[i + 1] === '{' ? matchBrace(spec, i + 1) : -1;
			const count = Number(spec.slice(i + 2, countClose));
			const bodyOpen = countClose + 1;
			const bodyClose =
				countClose !== -1 && spec[bodyOpen] === '{'
					? matchBrace(spec, bodyOpen)
					: -1;
			if (bodyClose === -1 || !Number.isInteger(count) || count < 1) {
				return null;
			}
			const repeated = parseColumnSpec(
				spec.slice(bodyOpen + 1, bodyClose).repeat(Math.min(count, 100)),
			);
			if (!repeated) return null;
			verticalRules[verticalRules.length - 1] += repeated.verticalRules[0];
			columns.push(...repeated.columns);
			verticalRules.push(...repeated.verticalRules.slice(1));
			i = bodyClose + 1;
		} else {
			// @{...}, >{...}, !{...} and others: left as LaTeX.
			return null;
		}
	}
	return columns.length > 0 ? { columns, verticalRules } : null;
};

/** Writes a column specification back. */
export const columnSpecText = (
	columns: TableColumn[],
	verticalRules: number[],
): string =>
	columns
		.map((column, index) => '|'.repeat(verticalRules[index] ?? 0) + column.spec)
		.join('') + '|'.repeat(verticalRules[columns.length] ?? 0);

// The cell starting at `from` and ending at `to`.
const makeCell = (text: string, from: number, to: number): TableCell => {
	let contentFrom = from;
	let contentTo = to;
	while (contentFrom < contentTo && isSpace(text[contentFrom])) contentFrom++;
	while (contentTo > contentFrom && isSpace(text[contentTo - 1])) contentTo--;
	if (contentFrom === contentTo) {
		contentFrom = to;
		contentTo = to;
	}
	const source = text.slice(contentFrom, contentTo);
	const multi = /^\\multicolumn\s*\{\s*(\d+)\s*\}\s*\{([^}]*)\}/.exec(source);
	const align = multi?.[2].replace(/[^lcr]/g, '')[0] as ColumnAlign | undefined;
	return {
		from,
		to,
		contentFrom,
		contentTo,
		source,
		span: multi ? Math.max(1, Number(multi[1])) : 1,
		...(align ? { align } : {}),
	};
};

/** Reads the tabular environment starting at `from`, or null. */
export function parseLatexTable(text: string, from: number): LatexTable | null {
	const begin = /^\\begin\s*\{(tabular\*?|tabularx)\}/.exec(
		text.slice(from, from + 40),
	);
	if (!begin || !TABLE_ENVS.has(begin[1])) return null;
	const env = begin[1];
	let pos = from + begin[0].length;

	pos = skipBlank(text, pos, text.length);
	if (WIDTH_ENVS.has(env)) {
		if (text[pos] !== '{') return null;
		const close = matchBrace(text, pos);
		if (close === -1) return null;
		pos = skipBlank(text, close + 1, text.length);
	} else {
		pos = skipBlank(text, skipBracket(text, pos), text.length);
	}
	if (text[pos] !== '{') return null;
	const specClose = matchBrace(text, pos);
	if (specClose === -1) return null;
	const specFrom = pos + 1;
	const specTo = specClose;
	const spec = parseColumnSpec(text.slice(specFrom, specTo));
	if (!spec) return null;

	const bodyFrom = specClose + 1;
	const end = new RegExp(`\\\\end\\s*\\{${env.replace('*', '\\*')}\\}`, 'g');
	end.lastIndex = bodyFrom;
	const endMatch = end.exec(text);
	if (!endMatch || endMatch.index - from > MAX_TABLE) return null;
	const bodyTo = endMatch.index;

	const rows: TableRow[] = [];
	let i = bodyFrom;
	let ruleBelow = false;
	let trailingFrom = bodyTo;
	while (i < bodyTo) {
		// The rules above a row.
		const ruleFrom = skipBlank(text, i, bodyTo);
		let j = ruleFrom;
		let ruleAbove = false;
		for (;;) {
			const rule = RULE.exec(text.slice(j, j + 12));
			if (!rule) break;
			ruleAbove = true;
			j += rule[0].length;
			j = skipBlank(text, j, bodyTo);
			// \cmidrule(lr){2-3}, \cline{2-3}
			if (text[j] === '(') j = text.indexOf(')', j) + 1 || j;
			if (text[j] === '{') j = matchBrace(text, j) + 1 || j;
			j = skipBlank(text, j, bodyTo);
		}
		if (j >= bodyTo) {
			ruleBelow = ruleAbove;
			trailingFrom = ruleFrom;
			break;
		}

		// The row's cells, up to its \\.
		const cells: TableCell[] = [];
		let cellFrom = i;
		let depth = 0;
		let k = j;
		let rowEnd = -1;
		let ended = false;
		while (k < bodyTo) {
			const char = text[k];
			if (char === '%') {
				k = lineEnd(text, k);
				continue;
			}
			if (char === '\\') {
				if (text[k + 1] === '\\' && depth === 0) {
					cells.push(makeCell(text, cellFrom, k));
					let after = k + 2;
					if (text[after] === '*') after++;
					const spaced = skipBlank(text, after, bodyTo);
					if (text[spaced] === '[') after = skipBracket(text, spaced);
					rowEnd = after;
					ended = true;
					break;
				}
				k += 2;
				continue;
			}
			if (char === '{') depth++;
			else if (char === '}') depth = Math.max(0, depth - 1);
			else if (char === '&' && depth === 0) {
				cells.push(makeCell(text, cellFrom, k));
				cellFrom = k + 1;
			}
			k++;
		}
		if (!ended) {
			cells.push(makeCell(text, cellFrom, bodyTo));
			rowEnd = cells[cells.length - 1].contentTo;
		}
		// The first cell starts after the rules.
		cells[0] = makeCell(text, j, cells[0].to);
		rows.push({
			ruleFrom,
			contentFrom: j,
			to: rowEnd,
			ended,
			ruleAbove,
			cells,
		});
		i = ended ? rowEnd : bodyTo;
	}

	const firstRow = rows[0];
	const indent = firstRow
		? (/^[ \t]*/.exec(
				text.slice(lineStart(text, firstRow.ruleFrom), firstRow.ruleFrom),
			)?.[0] ?? '')
		: '';

	return {
		env,
		from,
		to: endMatch.index + endMatch[0].length,
		specFrom,
		specTo,
		columns: spec.columns,
		verticalRules: spec.verticalRules,
		bodyFrom,
		bodyTo,
		rows,
		ruleBelow,
		trailingFrom,
		indent: /^[ \t]*$/.test(indent) ? indent : '',
	};
}

/** The tables of a document that the visual editor can show. */
export function findLatexTables(text: string): LatexTable[] {
	const tables: LatexTable[] = [];
	const begin = /\\begin\s*\{(tabular\*?|tabularx)\}/g;
	for (;;) {
		const match = begin.exec(text);
		if (!match) break;
		// Not in a comment.
		const start = lineStart(text, match.index);
		if (/(^|[^\\])%/.test(text.slice(start, match.index))) continue;
		const table = parseLatexTable(text, match.index);
		if (!table) continue;
		tables.push(table);
		begin.lastIndex = table.to;
	}
	return tables;
}

/** The cell of a row that covers column `col`, and the column it starts at. */
export const cellAt = (
	row: TableRow,
	col: number,
): { cell: TableCell; index: number; start: number } | null => {
	let start = 0;
	for (const [index, cell] of row.cells.entries()) {
		if (col < start + cell.span) return { cell, index, start };
		start += cell.span;
	}
	return null;
};

/** Whether every row has a rule above it and the last one below it. */
export const hasAllRules = (table: LatexTable): boolean =>
	table.rows.length > 0 &&
	table.rows.every((row) => row.ruleAbove) &&
	table.ruleBelow;

const emptyRow = (columns: number) => `${'& '.repeat(columns - 1)}\\\\`;

/** Puts `value` in a cell, as LaTeX. */
export function setCell(
	text: string,
	table: LatexTable,
	row: number,
	col: number,
	value: string,
): TableChange[] {
	const target = table.rows[row];
	if (!target) return [];
	const clean = value.replace(/\s*\n\s*/g, ' ').trim();
	const found = cellAt(target, col);
	if (!found) {
		// A row with fewer cells than columns gets the ones it lacks.
		const last = target.cells[target.cells.length - 1];
		const spans = target.cells.reduce((sum, cell) => sum + cell.span, 0);
		if (!clean || !last || col >= table.columns.length) return [];
		return [
			{
				from: last.contentTo,
				to: last.contentTo,
				insert: `${' &'.repeat(col - spans + 1)} ${clean}`,
			},
		];
	}
	const { cell } = found;
	if (cell.contentFrom === cell.contentTo) {
		if (!clean) return [];
		// Spaced from the separator before it.
		const before = text[cell.contentFrom - 1];
		const spaced = before === '&' ? ` ${clean} ` : `${clean} `;
		return [{ from: cell.contentFrom, to: cell.contentTo, insert: spaced }];
	}
	return [{ from: cell.contentFrom, to: cell.contentTo, insert: clean }];
}

// The whole lines from `from` to `to`, when nothing else is on them.
const wholeLines = (text: string, from: number, to: number): TableChange => {
	const start = lineStart(text, from);
	const end = lineEnd(text, to);
	const aloneBefore = text.slice(start, from).trim() === '';
	const aloneAfter = text.slice(to, end).trim() === '';
	return {
		from: aloneBefore ? start : from,
		to: aloneAfter && end < text.length ? end + 1 : to,
		insert: '',
	};
};

/** Adds an empty row above or below `row`. */
export function insertRow(
	text: string,
	table: LatexTable,
	row: number,
	where: 'above' | 'below',
): TableChange[] {
	const target = table.rows[row];
	if (!target) return [];
	const columns = table.columns.length;
	const rule = hasAllRules(table) ? '\\hline' : '';
	const indent = table.indent;
	if (where === 'above') {
		const at = target.contentFrom;
		const startsLine = text.slice(lineStart(text, at), at).trim() === '';
		const lines = [emptyRow(columns), rule].filter(Boolean);
		return [
			{
				from: at,
				to: at,
				insert: startsLine
					? `${lines.join(`\n${indent}`)}\n${text.slice(lineStart(text, at), at)}`
					: `${lines.join(' ')} `,
			},
		];
	}
	const lines = [rule, emptyRow(columns)].filter(Boolean);
	return [
		{
			from: target.to,
			to: target.to,
			insert:
				(target.ended ? '' : ' \\\\') +
				lines.map((line) => `\n${indent}${line}`).join(''),
		},
	];
}

/** Removes a row, with the rule above it when every row has one. */
export function deleteRow(
	text: string,
	table: LatexTable,
	row: number,
): TableChange[] {
	const target = table.rows[row];
	if (!target || table.rows.length < 2) return [];
	if (hasAllRules(table)) {
		// The first row keeps the rule above the table.
		const next = table.rows[row + 1];
		if (row === 0 && next) {
			return [{ from: target.contentFrom, to: next.contentFrom, insert: '' }];
		}
		return [wholeLines(text, target.ruleFrom, target.to)];
	}
	return [wholeLines(text, target.contentFrom, target.to)];
}

const specChange = (
	table: LatexTable,
	columns: TableColumn[],
	verticalRules: number[],
): TableChange => ({
	from: table.specFrom,
	to: table.specTo,
	insert: columnSpecText(columns, verticalRules),
});

/** Adds an empty column left or right of `col`. */
export function insertColumn(
	table: LatexTable,
	col: number,
	where: 'left' | 'right',
): TableChange[] {
	if (col < 0 || col >= table.columns.length) return [];
	const at = where === 'left' ? col : col + 1;
	const neighbour = table.columns[col];
	const columns = [...table.columns];
	columns.splice(at, 0, {
		align: neighbour.align === 'p' ? 'c' : neighbour.align,
		spec: neighbour.align === 'p' ? 'c' : neighbour.align,
	});
	// Ruled between all columns, the new one is too.
	const allRuled = table.verticalRules.every((count) => count > 0);
	const verticalRules = [...table.verticalRules];
	verticalRules.splice(at, 0, allRuled ? verticalRules[at] : 0);

	const changes: TableChange[] = [specChange(table, columns, verticalRules)];
	for (const row of table.rows) {
		const found = cellAt(row, col);
		if (!found) continue;
		const { cell, index } = found;
		if (where === 'left') {
			changes.push({
				from: cell.contentFrom,
				to: cell.contentFrom,
				insert: '& ',
			});
		} else if (index < row.cells.length - 1) {
			const next = row.cells[index + 1];
			changes.push({
				from: next.contentFrom,
				to: next.contentFrom,
				insert: '& ',
			});
		} else {
			changes.push({ from: cell.contentTo, to: cell.contentTo, insert: ' &' });
		}
	}
	return changes;
}

/** Removes a column. */
export function deleteColumn(table: LatexTable, col: number): TableChange[] {
	const count = table.columns.length;
	if (col < 0 || col >= count || count < 2) return [];
	const columns = table.columns.filter((_, index) => index !== col);
	const verticalRules = table.verticalRules.filter(
		(_, index) => index !== (col === count - 1 ? col : col + 1),
	);
	const changes: TableChange[] = [specChange(table, columns, verticalRules)];
	for (const row of table.rows) {
		const found = cellAt(row, col);
		if (!found || row.cells.length < 2) continue;
		const { index } = found;
		const cells = row.cells;
		if (index < cells.length - 1) {
			changes.push({
				from: cells[index].contentFrom,
				to: cells[index + 1].contentFrom,
				insert: '',
			});
		} else {
			changes.push({
				from: cells[index - 1].contentTo,
				to: cells[index].contentTo,
				insert: '',
			});
		}
	}
	return changes;
}

/** Aligns a column left, centred or right. */
export function setColumnAlign(
	table: LatexTable,
	col: number,
	align: 'l' | 'c' | 'r',
): TableChange[] {
	if (!table.columns[col] || table.columns[col].spec === align) return [];
	const columns = table.columns.map((column, index) =>
		index === col ? { align, spec: align } : column,
	);
	return [specChange(table, columns, table.verticalRules)];
}

/** Rules around every cell, or none, as Overleaf's border options. */
export function setBorders(
	text: string,
	table: LatexTable,
	borders: 'all' | 'none',
): TableChange[] {
	const all = borders === 'all';
	const verticalRules = table.verticalRules.map(() => (all ? 1 : 0));
	const indent = table.indent;
	const lines: string[] = [];
	for (const row of table.rows) {
		if (all) lines.push('\\hline');
		const cells = row.cells.map((cell) => cell.source).join(' & ');
		// A rule below needs the row ended.
		lines.push(row.ended || all ? `${cells} \\\\` : cells);
	}
	if (all) lines.push('\\hline');
	const endIndent = text.slice(lineStart(text, table.bodyTo), table.bodyTo);
	return [
		specChange(table, table.columns, verticalRules),
		{
			from: table.bodyFrom,
			to: table.bodyTo,
			insert: `${lines.map((line) => `\n${indent}${line}`).join('')}\n${/^[ \t]*$/.test(endIndent) ? endIndent : ''}`,
		},
	];
}

/** Applies changes made against the same text. */
export const applyChanges = (text: string, changes: TableChange[]): string =>
	[...changes]
		.sort((a, b) => b.from - a.from || b.to - a.to)
		.reduce(
			(result, change) =>
				result.slice(0, change.from) + change.insert + result.slice(change.to),
			text,
		);
