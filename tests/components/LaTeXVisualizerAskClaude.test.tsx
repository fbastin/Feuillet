import { fireEvent, render, screen } from '@testing-library/react';

import LaTeXVisualizer from '@extras/loggers/latex_visualizer/LaTeXVisualizer';
import { ASK_CLAUDE_EVENT, type AskClaudeRequest } from '@src/utils/askClaude';

// A pdfLaTeX log with one error in chapitres/intro.tex, line 7.
const LOG = [
	'This is pdfTeX, Version 3.141592653-2.6-1.40.26 (TeX Live 2026)',
	'(./main.tex',
	'LaTeX2e <2025-11-01>',
	'(./chapitres/intro.tex',
	'! Undefined control sequence.',
	'l.7 Le \\textbff',
	'               {gras}',
	')',
	')',
].join('\n');

describe('the log’s errors', () => {
	it('each offers to ask Claude to fix it, with where it is', () => {
		const asked: AskClaudeRequest[] = [];
		const listen = (event: Event) =>
			asked.push((event as CustomEvent<AskClaudeRequest>).detail);
		document.addEventListener(ASK_CLAUDE_EVENT, listen);
		render(<LaTeXVisualizer log={LOG} onLineClick={() => {}} />);

		const buttons = screen.getAllByRole('button', { name: /Ask Claude/ });
		expect(buttons).toHaveLength(1);
		fireEvent.click(buttons[0]);
		document.removeEventListener(ASK_CLAUDE_EVENT, listen);

		expect(asked).toHaveLength(1);
		expect(asked[0]).toMatchObject({
			path: '/chapitres/intro.tex',
			line: 7,
		});
		expect(asked[0].request).toMatch(/^Fix this compile error: .*Undefined control sequence/);
	});
});
