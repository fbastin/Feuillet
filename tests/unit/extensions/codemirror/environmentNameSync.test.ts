import { EditorState } from '@codemirror/state';

import {
	environmentNameSync,
	mirrorEdit,
} from '../../../../src/extensions/codemirror/environmentNameSync';

// Types `insert` in place of [from, to], as the user would.
const type = (doc: string, from: number, to: number, insert: string) => {
	const state = EditorState.create({ doc, extensions: [environmentNameSync()] });
	return state.update({ changes: { from, to, insert }, userEvent: 'input.type' })
		.state.doc.toString();
};
const at = (doc: string, needle: string, offset = 0) => doc.indexOf(needle) + offset;

describe('environmentNameSync', () => {
	const doc = '\\begin{itemize}\n\\item a\n\\end{itemize}\n';

	it('renames \\end when the name of \\begin changes', () => {
		const from = at(doc, 'itemize');
		expect(type(doc, from, from + 'itemize'.length, 'enumerate')).toBe(
			'\\begin{enumerate}\n\\item a\n\\end{enumerate}\n',
		);
	});

	it('renames \\begin when the name of \\end changes, letter by letter', () => {
		let text = doc;
		const last = text.lastIndexOf('itemize}') + 'itemize'.length;
		text = type(text, last - 1, last, ''); // itemiz
		expect(text).toBe('\\begin{itemiz}\n\\item a\n\\end{itemiz}\n');
		const start = text.lastIndexOf('itemiz}');
		text = type(text, start, start, 'x'); // xitemiz
		expect(text).toBe('\\begin{xitemiz}\n\\item a\n\\end{xitemiz}\n');
	});

	it('finds the right \\end among nested environments of the same name', () => {
		const nested =
			'\\begin{itemize}\n\\item\\begin{itemize}\\item b\\end{itemize}\n\\end{itemize}';
		const from = at(nested, 'itemize');
		expect(type(nested, from, from, 'x')).toBe(
			'\\begin{xitemize}\n\\item\\begin{itemize}\\item b\\end{itemize}\n\\end{xitemize}',
		);
		const inner = nested.indexOf('itemize', 10);
		expect(type(nested, inner, inner, 'y')).toBe(
			'\\begin{itemize}\n\\item\\begin{yitemize}\\item b\\end{yitemize}\n\\end{itemize}',
		);
	});

	it('leaves the file alone when the name is not balanced', () => {
		const unbalanced = '\\begin{itemize}\n\\item\\begin{itemize}\n\\end{itemize}';
		const from = at(unbalanced, 'itemize');
		expect(mirrorEdit(unbalanced, from, from, 'x')).toBeNull();
	});

	it('ignores commented environments', () => {
		const withComment =
			'\\begin{figure}\n% \\end{figure} as an example\n\\end{figure}';
		const from = at(withComment, 'figure');
		expect(type(withComment, from + 6, from + 6, '*')).toBe(
			'\\begin{figure*}\n% \\end{figure} as an example\n\\end{figure*}',
		);
		// \% is no comment.
		expect(mirrorEdit('50\\% \\begin{a}x\\end{a}', 12, 13, 'b')).toEqual({
			from: 20,
			to: 21,
			name: 'b',
		});
	});

	it('does nothing while a new environment is typed', () => {
		const typing = '\\begin{figure}\nx\n\\end{figure}\n\\begin{fig}';
		const from = typing.lastIndexOf('fig}') + 3;
		expect(type(typing, from, from, 'u')).toBe(`${typing.slice(0, from)}u}`);
	});

	it('does nothing outside a name, nor for remote or pasted braces', () => {
		const from = at(doc, '\\item a') + '\\item a'.length;
		expect(type(doc, from, from, 'b')).toBe(doc.replace('item a', 'item ab'));
		const name = at(doc, 'itemize');
		expect(mirrorEdit(doc, name, name + 7, 'a}b')).toBeNull();
		const state = EditorState.create({ doc, extensions: [environmentNameSync()] });
		const remote = state.update({ changes: { from: name, insert: 'x' } }).state;
		expect(remote.doc.toString()).toBe(doc.replace('{itemize}', '{xitemize}'));
	});

	it('stays out of names holding review or comment tags, and while paused', () => {
		const tagged =
			"\\begin{`<### review id: x, original: 'aXRlbWl6ZQ==' ###>`enum`</### review id: x ###>`}\n\\end{itemize}";
		const from = tagged.indexOf('enum') + 4;
		expect(mirrorEdit(tagged, from, from, 'e')).toBeNull();
		const name = at(doc, 'itemize');
		expect(mirrorEdit(doc, name, name, '`<### review')).toBeNull();
		const state = EditorState.create({
			doc,
			extensions: [environmentNameSync(() => true)],
		});
		const paused = state.update({
			changes: { from: name, insert: 'x' },
			userEvent: 'input.type',
		}).state;
		expect(paused.doc.toString()).toBe(doc.replace('{itemize}', '{xitemize}'));
	});

	it('undoes both ends together', () => {
		const from = at(doc, 'itemize');
		const state = EditorState.create({ doc, extensions: [environmentNameSync()] });
		const tr = state.update({ changes: { from, to: from + 7, insert: 'enumerate' }, userEvent: 'input.type' });
		expect(tr.changes.invert(state.doc).apply(tr.state.doc).toString()).toBe(doc);
	});
});
