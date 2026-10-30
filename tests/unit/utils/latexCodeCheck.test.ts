import { checkLatexCode as check } from '@src/utils/latexCodeCheck';

const MATH_ONLY = new Set([
	'\\arg',
	'\\sqrt',
	'\\alpha',
	'\\frac',
	'\\sum',
	'\\left',
	'\\right',
	'\\mathbb',
	'\\boldsymbol',
	'\\lvert',
	'\\rvert',
	'\\text',
]);
const checkLatexCode = (text: string) => check(text, MATH_ONLY);

const DOC = (body: string) =>
	`\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}\n${body}\n\\end{document}\n`;

// The problems as `kind command`, and the text they cover.
const problems = (text: string) =>
	checkLatexCode(text).map(
		(p) =>
			`${p.kind} ${p.command}${p.closing ? ` ${p.closing}` : ''} @${text.slice(p.from, p.to)}`,
	);

describe('LaTeX code check', () => {
	it('accepts correct LaTeX', () => {
		const text = DOC(
			[
				'\\section{Début}\\label{sec:debut_1}',
				'Texte avec $x_1^2$, \\(a_b\\) et \\[ \\sum_{i=1}^n i \\] puis $$y$$.',
				'\\begin{equation}\\label{eq:a_b} \\left( \\frac{a}{b} \\right) \\text{si $x_0$} \\end{equation}',
				'\\begin{align*} a &= b \\\\[2pt] c &= d \\intertext{et $e$} \\end{align*}',
				'Voir \\eqref{eq:a_b}, \\cite[p.~3]{knuth_84} et \\url{https://ex.org/a_b%20c}.',
				'\\href{https://ex.org/~a_b}{le site} et 50\\,\\% et \\$5 et \\{x\\}.',
				'\\includegraphics[width=0.5\\linewidth]{images/plan_1.png}',
				'\\verb|x_1 $ { %| et \\lstinline!a_b{!.',
				'\\begin{verbatim}',
				'\\begin{itemize} $ x_1 } {',
				'\\end{verbatim}',
				'\\begin{tikzpicture} \\node (a_1) at (0,0) {$\\alpha$}; \\end{tikzpicture}',
				'% \\begin{itemize} $ } commenté',
				'\\iffalse \\begin{itemize} \\fi',
				'\\ensuremath{\\alpha_1} et $\\mbox{texte \\(x\\)}$.',
			].join('\n'),
		);
		expect(problems(text)).toEqual([]);
	});

	it('leaves definitions alone', () => {
		const text = [
			'\\documentclass{article}',
			'\\makeatletter',
			'\\newcommand{\\R}{\\mathbb{R}}',
			'\\newcommand*\\vect[1]{\\boldsymbol{#1}_{i}}',
			'\\renewcommand\\@maketitle{\\begin{center}}',
			'\\newenvironment{boite}{\\begin{center}\\bfseries}{\\end{center}}',
			'\\def\\x#1{\\left(#1}',
			'\\let\\ancien=\\alpha',
			'\\DeclareMathOperator*{\\argmax}{arg\\,max}',
			'\\DeclarePairedDelimiter\\abs{\\lvert}{\\rvert}',
			'\\begin{document}',
			'$\\R$ et \\begin{boite} x \\end{boite}',
			'\\end{document}',
			'Après la fin, rien n\'est lu: $ \\begin{x}',
		].join('\n');
		expect(problems(text)).toEqual([]);
	});

	it('knows what the file declares, and common packages', () => {
		const text = [
			'\\documentclass{article}',
			'\\usepackage{fancyvrb,listings}',
			'\\MakeShortVerb{\\|}',
			'\\DefineVerbatimEnvironment{code}{Verbatim}{}',
			'\\lstnewenvironment{python}{}{}',
			'\\renewcommand{\\arg}[1]{\\texttt{#1}}',
			'\\ExplSyntaxOn',
			'\\int_new:N \\l_my_int \\cs_new:Npn \\my_f:n #1 { #1 }',
			'\\ExplSyntaxOff',
			'\\begin{document}',
			'Écrire |x_1 $| ou \\arg{nom}.',
			'\\begin{code}',
			'\\begin{itemize} $ x_1',
			'\\end{code}',
			'\\begin{python}',
			'a_b = { "c": 1 }',
			'\\end{python}',
			'Vitesse de \\SI{3}{\\metre\\per\\square\\second} et \\qty{2}{\\per\\sqrt\\hertz}.',
			'$\\[ \\autorightleftharpoons{$k_a$}{$k_b$} \\]$'.slice(1, -1),
			'\\newcolumntype{L}{>{$}l<{$}}',
			'\\begin{tabular}{@{}>{$\\displaystyle}l<{$}L@{}} x & y \\end{tabular}',
			'\\addtocontents{toc}{\\protect\\begin{multicols}{2}}',
			'$\\parbox{3cm}{Texte et $x_1$}$',
			'\\end{document}',
		].join('\n');
		expect(problems(text)).toEqual([]);
		// Without its declaration, |...| and \\arg are what LaTeX makes them.
		expect(problems(DOC('Voir \\arg et |x_1|.'))).toEqual([
			'mathOnly \\arg @\\arg',
			'mathOnly _ @_',
		]);
	});

	it('finds environments that do not pair up', () => {
		expect(
			problems(DOC('\\begin{itemize}\n\\item a\n\\end{enumerate}')),
		).toEqual([
			'closedBy \\begin{itemize} \\end{enumerate} @\\end{enumerate}',
		]);
		expect(problems(DOC('\\begin{figure}\nTexte.'))).toEqual([
			'unclosed \\begin{figure} @\\begin{figure}',
		]);
		expect(problems(DOC('Texte.\n\\end{center}'))).toEqual([
			'closesNothing \\end{center} @\\end{center}',
		]);
		expect(problems('\\begin{document}\nTexte.')).toEqual([
			'unclosed \\begin{document} @\\begin{document}',
		]);
	});

	it('finds braces that do not pair up', () => {
		expect(problems(DOC('Texte} en trop.'))).toEqual(['closesNothing } @}']);
		expect(problems(DOC('\\textbf{gras\n\\end{center}'))).toContain(
			'closesNothing \\end{center} @\\end{center}',
		);
		expect(problems(DOC('\\begin{center}\n\\textbf{gras\n\\end{center}'))).toEqual(
			['unclosed { @{'],
		);
		expect(problems('\\section{Titre')).toEqual(['unclosed { @{']);
	});

	it('finds math left open', () => {
		expect(problems(DOC('Soit $x = 1 et la suite.\n\nAutre.'))).toEqual([
			'paragraphEnd $ @$',
		]);
		expect(problems(DOC('\\[ x = 1\n\nTexte.'))).toEqual(['paragraphEnd \\[ @\\[']);
		expect(problems(DOC('Fin \\) ici.'))).toEqual(['closesNothing \\) @\\)']);
		expect(problems(DOC('$\\frac{a$ et b.'))).toEqual(['unclosed { @{']);
		expect(problems(DOC('$\\left( x$'))).toEqual(['unclosed \\left @\\left']);
		expect(problems(DOC('$ x \\right) $'))).toEqual([
			'closesNothing \\right @\\right',
		]);
		expect(
			problems(DOC('\\begin{equation}\nx = 1\n\ny = 2\n\\end{equation}')),
		).toEqual(['blankLineInMath \\begin{equation} @\\begin{equation}']);
	});

	it('finds math where it does not belong', () => {
		expect(problems(DOC('\\[ $x$ \\]'))).toEqual([
			'notAllowedInMath $ @$',
			'notAllowedInMath $ @$',
		]);
		expect(problems(DOC('$\\begin{equation} x \\end{equation}$'))).toEqual([
			'notAllowedInMath \\begin{equation} @\\begin{equation}',
		]);
		expect(problems(DOC('Soit x_1 et \\alpha ici.'))).toEqual([
			'mathOnly _ @_',
			'mathOnly \\alpha @\\alpha',
		]);
		const severities = checkLatexCode(DOC('x_1 \\alpha')).map((p) => p.severity);
		expect(severities).toEqual(['warning', 'error']);
	});

	it('warns of a document class without a document', () => {
		const found = checkLatexCode('\\documentclass{article}\n\\usepackage{x}\n');
		expect(found).toMatchObject([
			{ kind: 'missing', command: '\\begin{document}', severity: 'warning' },
		]);
	});

	it('reads files included by others without complaint', () => {
		const chapter = [
			'\\chapter{Introduction}\\label{chap:intro}',
			'Comme le montre la figure~\\ref{fig:plan} du chapitre~\\ref{chap:methodes},',
			'et selon \\cite{knuth}, le texte continue.',
		].join('\n');
		expect(problems(chapter)).toEqual([]);
	});

	it('stops at a hundred problems', () => {
		expect(checkLatexCode('}'.repeat(500))).toHaveLength(100);
	});
});
