import {
	applyChanges,
	cellAt,
	deleteColumn,
	deleteRow,
	findLatexTables,
	insertColumn,
	insertRow,
	parseColumnSpec,
	parseLatexTable,
	setBorders,
	setCell,
	setColumnAlign,
} from '@src/extensions/codemirror/visual/latexTable';

const RULED = [
	'\\begin{table}[h]',
	'\t\\centering',
	'\t\\begin{tabular}{|c|c|}',
	'\t\t\\hline',
	'\t\tNom & Valeur \\\\',
	'\t\t\\hline',
	'\t\tA & 1 \\\\',
	'\t\t\\hline',
	'\t\\end{tabular}',
	'\t\\caption{Résultats}',
	'\\end{table}',
].join('\n');

const BOOKTABS = [
	'\\begin{tabular}{lr}',
	'  \\toprule',
	'  Article & Prix \\\\',
	'  \\midrule',
	'  Pomme & \\$2 \\\\',
	'  Poire &  \\\\',
	'  \\bottomrule',
	'\\end{tabular}',
].join('\n');

const only = (text: string) => {
	const table = findLatexTables(text)[0];
	if (!table) throw new Error('no table');
	return table;
};
const cells = (text: string) =>
	only(text).rows.map((row) => row.cells.map((cell) => cell.source));
const edit = (text: string, change: (table: ReturnType<typeof only>) => ReturnType<typeof setCell>) =>
	applyChanges(text, change(only(text)));

describe('reading tables', () => {
	it('reads columns, rules and cells', () => {
		const table = only(RULED);
		expect(table.env).toBe('tabular');
		expect(table.columns.map((column) => column.align)).toEqual(['c', 'c']);
		expect(table.verticalRules).toEqual([1, 1, 1]);
		expect(cells(RULED)).toEqual([
			['Nom', 'Valeur'],
			['A', '1'],
		]);
		expect(table.rows.map((row) => row.ruleAbove)).toEqual([true, true]);
		expect(table.ruleBelow).toBe(true);
		expect(table.indent).toBe('\t\t');
		expect(RULED.slice(table.from, table.to)).toMatch(/^\\begin\{tabular\}[\s\S]*\\end\{tabular\}$/);
	});

	it('reads booktabs rules, escapes and empty cells', () => {
		const table = only(BOOKTABS);
		expect(table.columns.map((column) => column.align)).toEqual(['l', 'r']);
		expect(cells(BOOKTABS)).toEqual([
			['Article', 'Prix'],
			['Pomme', '\\$2'],
			['Poire', ''],
		]);
		expect(table.rows.map((row) => row.ruleAbove)).toEqual([true, true, false]);
		expect(table.ruleBelow).toBe(true);
	});

	it('keeps braces, \\& and \\\\ inside cells', () => {
		const text = '\\begin{tabular}{ll}\n\\textbf{a & b} & x \\& y \\\\\n\\makecell{1\\\\2} & z\n\\end{tabular}';
		expect(cells(text)).toEqual([
			['\\textbf{a & b}', 'x \\& y'],
			['\\makecell{1\\\\2}', 'z'],
		]);
		expect(only(text).rows[1].ended).toBe(false);
	});

	it('reads spans, repeated and paragraph columns', () => {
		const text = '\\begin{tabular}{*{2}{c}p{3cm}}\n\\multicolumn{2}{r}{Large} & x \\\\\n\\end{tabular}';
		const table = only(text);
		expect(table.columns.map((column) => column.spec)).toEqual(['c', 'c', 'p{3cm}']);
		const row = table.rows[0];
		expect(row.cells[0]).toMatchObject({ span: 2, align: 'r' });
		expect(cellAt(row, 1)?.index).toBe(0);
		expect(cellAt(row, 2)?.cell.source).toBe('x');
	});

	it('reads tabularx and tabular* widths and a position', () => {
		expect(only('\\begin{tabularx}{\\linewidth}{lX}a & b\\end{tabularx}').columns).toHaveLength(2);
		expect(only('\\begin{tabular*}{5cm}{cc}a & b\\end{tabular*}').columns).toHaveLength(2);
		expect(only('\\begin{tabular}[t]{c}a\\end{tabular}').columns).toHaveLength(1);
	});

	it('leaves what it does not handle as LaTeX', () => {
		expect(parseColumnSpec('@{}ll@{}')).toBeNull();
		expect(parseColumnSpec('>{\\bfseries}l')).toBeNull();
		expect(findLatexTables('\\begin{tabular}{@{}l}a\\end{tabular}')).toEqual([]);
		expect(findLatexTables('% \\begin{tabular}{l}a\\end{tabular}')).toEqual([]);
		expect(findLatexTables('\\begin{tabular}{l}a')).toEqual([]);
		expect(parseLatexTable('\\begin{tabular}{l}', 0)).toBeNull();
	});
});

describe('editing tables', () => {
	it('puts text in a cell, and in an empty one', () => {
		expect(cells(edit(RULED, (table) => setCell(RULED, table, 1, 1, '42')))).toEqual([
			['Nom', 'Valeur'],
			['A', '42'],
		]);
		const filled = edit(BOOKTABS, (table) => setCell(BOOKTABS, table, 2, 1, '\\$3'));
		expect(filled).toContain('  Poire &  \\$3 \\\\');
		expect(cells(filled)[2]).toEqual(['Poire', '\\$3']);
		const first = '\\begin{tabular}{cc}\n  & b \\\\\n\\end{tabular}';
		expect(edit(first, (table) => setCell(first, table, 0, 0, 'a'))).toContain('\n  a & b \\\\');
	});

	it('fills a cell a short row lacks', () => {
		const text = '\\begin{tabular}{ccc}\na \\\\\n\\end{tabular}';
		expect(cells(edit(text, (table) => setCell(text, table, 0, 2, 'c')))).toEqual([['a', '', 'c']]);
		expect(setCell(text, only(text), 0, 3, 'd')).toEqual([]);
	});

	it('adds rows above and below, with their rule when every row has one', () => {
		const below = edit(RULED, (table) => insertRow(RULED, table, 0, 'below'));
		expect(cells(below)).toEqual([['Nom', 'Valeur'], ['', ''], ['A', '1']]);
		expect(only(below).rows.every((row) => row.ruleAbove)).toBe(true);
		expect(below).toContain('\t\tNom & Valeur \\\\\n\t\t\\hline\n\t\t& \\\\\n\t\t\\hline\n\t\tA & 1');
		const above = edit(RULED, (table) => insertRow(RULED, table, 0, 'above'));
		expect(cells(above)).toEqual([['', ''], ['Nom', 'Valeur'], ['A', '1']]);
		expect(only(above).rows.every((row) => row.ruleAbove)).toBe(true);
		const plain = edit(BOOKTABS, (table) => insertRow(BOOKTABS, table, 2, 'below'));
		expect(cells(plain)[3]).toEqual(['', '']);
		expect(plain).toContain('  Poire &  \\\\\n  & \\\\\n  \\bottomrule');
	});

	it('ends a last row without \\\\ before adding one below', () => {
		const text = '\\begin{tabular}{cc}\na & b\n\\end{tabular}';
		expect(cells(edit(text, (table) => insertRow(text, table, 0, 'below')))).toEqual([
			['a', 'b'],
			['', ''],
		]);
	});

	it('deletes rows with the rule above them when every row has one', () => {
		const first = edit(RULED, (table) => deleteRow(RULED, table, 0));
		expect(cells(first)).toEqual([['A', '1']]);
		expect(only(first).rows[0].ruleAbove && only(first).ruleBelow).toBe(true);
		expect(first.match(/\\hline/g)).toHaveLength(2);
		const second = edit(RULED, (table) => deleteRow(RULED, table, 1));
		expect(cells(second)).toEqual([['Nom', 'Valeur']]);
		expect(second.match(/\\hline/g)).toHaveLength(2);
		expect(cells(edit(BOOKTABS, (table) => deleteRow(BOOKTABS, table, 1)))).toEqual([
			['Article', 'Prix'],
			['Poire', ''],
		]);
		const one = '\\begin{tabular}{c}\na\n\\end{tabular}';
		expect(deleteRow(one, only(one), 0)).toEqual([]);
	});

	it('adds columns left and right, ruled like the others', () => {
		const right = edit(RULED, (table) => insertColumn(table, 1, 'right'));
		expect(only(right).columns).toHaveLength(3);
		expect(right).toContain('{|c|c|c|}');
		expect(cells(right)).toEqual([['Nom', 'Valeur', ''], ['A', '1', '']]);
		const left = edit(BOOKTABS, (table) => insertColumn(table, 0, 'left'));
		expect(left).toContain('{llr}');
		expect(cells(left)).toEqual([['', 'Article', 'Prix'], ['', 'Pomme', '\\$2'], ['', 'Poire', '']]);
		const middle = edit(BOOKTABS, (table) => insertColumn(table, 0, 'right'));
		expect(cells(middle)[0]).toEqual(['Article', '', 'Prix']);
	});

	it('deletes columns', () => {
		const first = edit(RULED, (table) => deleteColumn(table, 0));
		expect(first).toContain('{|c|}');
		expect(cells(first)).toEqual([['Valeur'], ['1']]);
		const last = edit(BOOKTABS, (table) => deleteColumn(table, 1));
		expect(last).toContain('{l}');
		expect(cells(last)).toEqual([['Article'], ['Pomme'], ['Poire']]);
	});

	it('aligns a column', () => {
		const right = edit(RULED, (table) => setColumnAlign(table, 0, 'r'));
		expect(right).toContain('{|r|c|}');
		expect(setColumnAlign(only(RULED), 0, 'c')).toEqual([]);
	});

	it('draws every border, or none', () => {
		const all = edit(BOOKTABS, (table) => setBorders(BOOKTABS, table, 'all'));
		expect(all).toContain('{|l|r|}');
		expect(only(all).rows.every((row) => row.ruleAbove) && only(all).ruleBelow).toBe(true);
		expect(all).not.toMatch(/toprule|midrule|bottomrule/);
		expect(cells(all)).toEqual(cells(BOOKTABS));
		const none = edit(RULED, (table) => setBorders(RULED, table, 'none'));
		expect(none).toContain('{cc}');
		expect(none).not.toContain('\\hline');
		expect(cells(none)).toEqual(cells(RULED));
		expect(none).toContain('\t\t\\begin{tabular}'.slice(2));
		expect(none).toMatch(/\n\t\\end\{tabular\}/);
	});
});
