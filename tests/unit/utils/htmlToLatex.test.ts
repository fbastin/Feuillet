import { escapeLatex, htmlToLatex } from '@src/utils/htmlToLatex';

describe('formatted text pasted as LaTeX', () => {
	it('keeps emphasis, from tags or from styles', () => {
		expect(
			htmlToLatex(
				'<p>Un <b>mot</b>, un <em>autre</em> et <u>souligné</u>, x<sup>2</sup> et H<sub>2</sub>O.</p>',
			),
		).toBe(
			'Un \\textbf{mot}, un \\textit{autre} et \\underline{souligné}, x\\textsuperscript{2} et H\\textsubscript{2}O.',
		);
	});

	it('reads Google Docs, whose outer <b> is not bold', () => {
		const docs =
			'<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1"><p dir="ltr"><span style="font-weight:700;">Gras</span><span style="font-weight:400;"> puis </span><span style="font-style:italic;">italique</span></p><h2 dir="ltr"><span>Méthode</span></h2><ul><li dir="ltr"><p dir="ltr"><span>premier</span></p></li><li><p><span>second</span></p></li></ul></b>';
		expect(htmlToLatex(docs)).toBe(
			[
				'\\textbf{Gras} puis \\textit{italique}',
				'',
				'\\subsection{Méthode}',
				'',
				'\\begin{itemize}',
				'  \\item premier',
				'  \\item second',
				'\\end{itemize}',
			].join('\n'),
		);
	});

	it("reads Word's paragraphs and lists", () => {
		const word = `<html><head><style>p.MsoNormal{margin:0}</style></head><body>
<!--StartFragment--><p class=MsoNormal><b><span>Résumé</span></b><o:p></o:p></p>
<p class=MsoListParagraphCxSpFirst style='mso-list:l0 level1 lfo1'><![if !supportLists]><span style='mso-list:Ignore'>·<span>&nbsp;&nbsp;</span></span><![endif]>Un</p>
<p class=MsoListParagraphCxSpLast style='mso-list:l0 level1 lfo1'><span style='mso-list:Ignore'>·<span>&nbsp;&nbsp;</span></span>Deux</p>
<p class=MsoNormal>Fin à 50&nbsp;%.<o:p>&nbsp;</o:p></p><!--EndFragment--></body></html>`;
		expect(htmlToLatex(word)).toBe(
			[
				'\\textbf{Résumé}',
				'',
				'\\begin{itemize}',
				'  \\item Un',
				'  \\item Deux',
				'\\end{itemize}',
				'',
				'Fin à 50 \\%.',
			].join('\n'),
		);
	});

	it('turns headings, numbered lists, links, quotations and tables into LaTeX', () => {
		expect(htmlToLatex('<h1>Introduction</h1><h3>Détail</h3>')).toBe(
			'\\section{Introduction}\n\n\\subsubsection{Détail}',
		);
		expect(htmlToLatex('<ol><li>a</li><li>b <i>c</i></li></ol>')).toBe(
			'\\begin{enumerate}\n  \\item a\n  \\item b \\textit{c}\n\\end{enumerate}',
		);
		expect(
			htmlToLatex(
				'<p>Voir <a href="https://ex.org/a#b">le site</a> ou https://ex.org/ : <a href="https://ex.org/">https://ex.org/</a></p>',
			),
		).toBe(
			'Voir \\href{https://ex.org/a\\#b}{le site} ou https://ex.org/ : \\url{https://ex.org/}',
		);
		expect(htmlToLatex('<blockquote><p>Cité.</p></blockquote>')).toBe(
			'\\begin{quote}\nCité.\n\\end{quote}',
		);
		expect(
			htmlToLatex(
				'<table><tr><th>Essai</th><th>Durée</th></tr><tr><td>A</td><td>12,5</td></tr><tr><td>B</td></tr></table>',
			),
		).toBe(
			[
				'\\begin{tabular}{ll}',
				'  \\hline',
				'  Essai & Durée \\\\',
				'  \\hline',
				'  A & 12,5 \\\\',
				'  B &  \\\\',
				'  \\hline',
				'\\end{tabular}',
			].join('\n'),
		);
	});

	it("escapes LaTeX's special characters, and drops a line break ending a paragraph", () => {
		expect(escapeLatex('50% de $5 & #1_a ^ ~ {x} \\')).toBe(
			'50\\% de \\$5 \\& \\#1\\_a \\^{} \\~{} \\{x\\} \\textbackslash{}',
		);
		expect(htmlToLatex('<p>ligne<br>suivante<br></p><p>fin</p>')).toBe(
			'ligne\\\\\nsuivante\n\nfin',
		);
	});

	it('leaves plain text, code and images to the usual paste', () => {
		expect(htmlToLatex('<p>Du texte simple.</p>')).toBeNull();
		expect(htmlToLatex('<pre>\\section{x}</pre>')).toBeNull();
		expect(htmlToLatex('<img src="data:image/png;base64,AAAA">')).toBeNull();
		expect(htmlToLatex('')).toBeNull();
	});
});
