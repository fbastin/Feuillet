import {
	MAX_PASSAGE_CHARS,
	askClaudePrompt,
	claudeUrl,
	passageOf,
} from '../../src/utils/askClaude';

const context = {
	projectName: 'Thèse',
	projectId: 'abc-123',
	path: '/chapitres/intro.tex',
	line: 12,
};

describe('Ask Claude', () => {
	it('says where the person is, quotes the passage and asks for suggestions', () => {
		const prompt = askClaudePrompt(
			{ ...context, selection: 'Le chat dort.' },
			'  Améliore le style.  ',
		);
		expect(prompt).toBe(
			[
				'In my Feuillet project "Thèse" (id abc-123), file /chapitres/intro.tex, line 12:',
				'',
				'```latex',
				'Le chat dort.',
				'```',
				'',
				'Améliore le style.',
				'',
				'Use the Feuillet connector: read the file first, then make your changes with edit_file, as suggestions.',
			].join('\n'),
		);
	});

	it('names only the project without a file or a passage', () => {
		const prompt = askClaudePrompt(
			{ projectName: '', projectId: 'abc-123' },
			'Compile.',
		);
		expect(prompt.split('\n')[0]).toBe(
			'In my Feuillet project "Untitled Project" (id abc-123):',
		);
		expect(prompt).not.toContain('```');
	});

	it('quotes the passage as people read it, and cuts a long one short', () => {
		const tagged =
			"Un `<### comment id: x1, user: a, time: 1, content64: '', responses: [], resolved: false ###>`mot`</### comment id: x1 ###>` commenté.";
		expect(passageOf(tagged)).toEqual({
			text: 'Un mot commenté.',
			truncated: false,
		});
		const long = passageOf('a'.repeat(MAX_PASSAGE_CHARS + 10));
		expect(long.truncated).toBe(true);
		expect(long.text).toHaveLength(MAX_PASSAGE_CHARS + 1);
		const prompt = askClaudePrompt(
			{ ...context, path: '/refs.bib', selection: 'b'.repeat(MAX_PASSAGE_CHARS + 1) },
			'Vérifie.',
		);
		expect(prompt).toContain('```bibtex');
		expect(prompt).toContain('(The passage is cut short: read the file for the rest.)');
	});

	it('opens claude.ai with the message', () => {
		expect(claudeUrl('Bonjour & merci ?')).toBe(
			'https://claude.ai/new?q=Bonjour%20%26%20merci%20%3F',
		);
	});
});
