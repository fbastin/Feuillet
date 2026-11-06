import { latexHint } from '@extras/loggers/latex_visualizer/hints';
import { parseLatexLog } from '@extras/loggers/latex_visualizer/parser';

jest.mock('@/i18n', () => ({
    t: (key: string, params?: Record<string, unknown>) =>
        params
            ? key.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ''))
            : key,
}));

// Excerpts of logs from pdflatex (TeX Live 2023) on faulty documents.
const hintOf = (log: string, index = 0) => parseLatexLog(log)[index]?.hint;

describe('explanations of LaTeX errors', () => {
    it('names the undefined command', () => {
        const hint = hintOf(`! Undefined control sequence.
l.4 Bonjour \\foo
                 {} monde.`);
        expect(hint).toContain('TeX does not know the command \\foo.');
        expect(hint).toContain('\\usepackage{…}');
    });

    it('tells PSTricks to compile with LaTeX', () => {
        const hint = hintOf(`! Undefined control sequence.
\\c@lor@to@ps ->\\PSTricks 
                         _Not_Configured_For_This_Format
l.4 ...pspicture}(0,0)(2,1)\\psline[linecolor=red](
                                                  0,0)(2,1)\\end{pspicture}`);
        expect(hint).toContain('PSTricks draws with PostScript');
        expect(hint).toContain('Choose LaTeX (or XeLaTeX)');
    });

    it('explains math outside math mode', () => {
        expect(hintOf(`! Missing $ inserted.
<inserted text> 
                $
l.4 Un indice x_
                1 ici.`)).toContain('outside math mode');
    });

    it('names the package of a known environment', () => {
        expect(
            hintOf(`! LaTeX Error: Environment align undefined.

See the LaTeX manual or LaTeX Companion for explanation.
Type  H <return>  for immediate help.
 ...                                              
                                                  
l.4 \\begin{align}`),
        ).toBe(
            'The environment align is not defined: it comes from the package amsmath. Add \\usepackage{amsmath} to the preamble.',
        );
    });

    it('tells which environments do not match', () => {
        expect(
            hintOf(`! LaTeX Error: \\begin{itemize} on input line 3 ended by \\end{enumerate}.

See the LaTeX manual or LaTeX Companion for explanation.
Type  H <return>  for immediate help.
 ...                                              
                                                  
l.5 \\end{enumerate}`),
        ).toContain('The environment itemize, opened on line 3, is closed by \\end{enumerate}.');
    });

    it('tells a missing package from a missing file', () => {
        expect(hintOf(`! LaTeX Error: File \`nonexistentpkgzz.sty' not found.`)).toContain(
            'The package or class nonexistentpkgzz is not installed',
        );
        expect(hintOf(`! LaTeX Error: File \`chapitres/absent.tex' not found.`)).toContain(
            'The file chapitres/absent.tex cannot be found.',
        );
    });

    it('explains a Unicode character pdfLaTeX cannot print', () => {
        expect(hintOf(`! LaTeX Error: Unicode character ✓ (U+2713)
               not set up for use with LaTeX.`)).toContain('The character ✓ (U+2713) is not available with pdfLaTeX');
    });

    it('explains table and brace errors', () => {
        expect(hintOf(`! Misplaced alignment tab character &.
l.4 A &`)).toContain('write \\&');
        expect(hintOf(`! Extra alignment tab has been changed to \\cr.
<template> \\endtemplate
l.4 \\begin{tabular}{ll}a&b&`)).toContain('more cells');
        expect(hintOf(`! Too many }'s.
l.4 Texte }`)).toContain('more closing braces');
        expect(hintOf(`! Double superscript.
l.4 $x^2^`)).toContain('x^{2^3}');
    });

    it('explains warnings about references and boxes', () => {
        const entries = parseLatexLog(`LaTeX Warning: Citation \`absent' on page 1 undefined on input line 4.
LaTeX Warning: Reference \`nulle' on page 1 undefined on input line 4.
Overfull \\hbox (42.0pt too wide) in paragraph at lines 4--5
LaTeX Warning: There were undefined references.`);
        expect(entries.map((entry) => entry.hint)).toEqual([
            expect.stringContaining('The citation absent is not in the bibliography.'),
            expect.stringContaining('The label nulle does not exist'),
            expect.stringContaining('A line runs into the margin'),
            expect.stringContaining('Some references'),
        ]);
    });

    it('explains the messages the parser words itself', () => {
        const hints = parseLatexLog(`! Emergency stop.
*** (job aborted, file error in nonstop mode)
Missing character: There is no ✓ in font cmr10!`).map((entry) => entry.hint);
        expect(hints.every(Boolean)).toBe(true);
    });

    it('leaves alone what it does not know', () => {
        expect(latexHint({ type: 'error', message: 'Something odd happened.' })).toBeUndefined();
        expect(hintOf(`! LaTeX Error: Something went wrong.
l.42 \\badcommand`)).toBeUndefined();
    });
});
