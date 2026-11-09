// src/extensions/codemirror/languageDocs/latexDocsData.ts
// The descriptions the LaTeX language package shows on hover
// (codemirror-lang-latex 0.6.1, commandInfoMap and environmentInfoMap), in
// the user's language: the English text is the translation key. Read at
// hover time, so that a change of language applies at once.
import { t } from '@/i18n';

export interface LatexDoc {
	description: string;
	syntax: string;
	example?: string;
	package?: string;
}

export const LATEX_COMMAND_DOCS: Record<string, () => LatexDoc> = {
	'\\documentclass': () => ({
		description: t('Defines the type of document to be created.'),
		syntax: t('\\documentclass[options]{class}'),
		example: '\\documentclass[12pt,a4paper]{article}',
	}),
	'\\usepackage': () => ({
		description: t('Loads a LaTeX package.'),
		syntax: t('\\usepackage[options]{package}'),
		example: '\\usepackage{graphicx}',
	}),
	'\\begin': () => ({
		description: t('Begins an environment.'),
		syntax: t('\\begin{environment}'),
		example: '\\begin{document}',
	}),
	'\\end': () => ({
		description: t('Ends an environment.'),
		syntax: t('\\end{environment}'),
		example: '\\end{document}',
	}),
	'\\section': () => ({
		description: t('Creates a section heading.'),
		syntax: t('\\section[short title]{title}'),
		example: '\\section{Introduction}',
	}),
	'\\subsection': () => ({
		description: t('Creates a subsection heading.'),
		syntax: t('\\subsection[short title]{title}'),
		example: t('\\subsection{Method}'),
	}),
	'\\subsubsection': () => ({
		description: t('Creates a subsubsection heading.'),
		syntax: t('\\subsubsection[short title]{title}'),
		example: t('\\subsubsection{Implementation details}'),
	}),
	'\\textbf': () => ({
		description: t('Sets text in bold font.'),
		syntax: t('\\textbf{text}'),
		example: t('\\textbf{Important note}'),
	}),
	'\\textit': () => ({
		description: t('Sets text in italic font.'),
		syntax: t('\\textit{text}'),
		example: t('\\textit{Emphasized term}'),
	}),
	'\\emph': () => ({
		description: t('Emphasizes text. Typically renders as italic.'),
		syntax: t('\\emph{text}'),
		example: '\\emph{Important}',
	}),
	'\\cite': () => ({
		description: t('Creates a citation.'),
		syntax: t('\\cite[text]{key}'),
		example: t('\\cite{smith2020}'),
	}),
	'\\ref': () => ({
		description: t('Creates a reference to a labeled element.'),
		syntax: t('\\ref{label}'),
		example: t('\\ref{fig:sample}'),
	}),
	'\\label': () => ({
		description: t('Assigns a label to an element for referencing.'),
		syntax: t('\\label{name}'),
		example: '\\label{sec:introduction}',
	}),
	'\\includegraphics': () => ({
		description: t('Includes a graphics file.'),
		syntax: t('\\includegraphics[options]{filename}'),
		example: '\\includegraphics[width=0.8\\textwidth]{figure.png}',
		package: 'graphicx',
	}),
	'\\frac': () => ({
		description: t('Creates a fraction.'),
		syntax: t('\\frac{numerator}{denominator}'),
		example: '\\frac{a}{b}',
		package: t('amsmath (optional)'),
	}),
	'\\item': () => ({
		description: t('Defines an item in a list environment.'),
		syntax: t('\\item[optional label] content'),
		example: t('\\item First item in list'),
	}),
	'\\maketitle': () => ({
		description: t(
			'Generates a title based on \\title, \\author, and \\date commands.',
		),
		syntax: '\\maketitle',
		example: '\\maketitle',
	}),
	'\\title': () => ({
		description: t('Specifies the document title.'),
		syntax: t('\\title{title}'),
		example: t('\\title{My Document}'),
	}),
	'\\author': () => ({
		description: t('Specifies the document author(s).'),
		syntax: t('\\author{name}'),
		example: t('\\author{John Smith}'),
	}),
	'\\date': () => ({
		description: t('Specifies the document date.'),
		syntax: '\\date{date}',
		example: '\\date{\\today}',
	}),
	'\\caption': () => ({
		description: t('Adds a caption to a figure or table.'),
		syntax: t('\\caption{text}'),
		example: t('\\caption{A sample figure}'),
	}),
	'\\hline': () => ({
		description: t('Draws a horizontal line in a table.'),
		syntax: '\\hline',
		example: '\\hline',
	}),
	'\\newcommand': () => ({
		description: t('Defines a new command.'),
		syntax: t('\\newcommand{\\name}[args][default]{definition}'),
		example: t('\\newcommand{\\mycommand}[1]{Hello #1!}'),
	}),
};

export const LATEX_ENVIRONMENT_DOCS: Record<string, () => LatexDoc> = {
	document: () => ({
		description: t(
			'The main document environment. All visible content must be inside this environment.',
		),
		syntax: '\\begin{document}...\\end{document}',
		example: t('\\begin{document}\nHello, world!\n\\end{document}'),
	}),
	figure: () => ({
		description: t('Environment for floating figures.'),
		syntax: t('\\begin{figure}[placement]...\\end{figure}'),
		example: t(
			'\\begin{figure}[ht]\n\\centering\n\\includegraphics{image.png}\n\\caption{A figure}\n\\label{fig:example}\n\\end{figure}',
		),
	}),
	table: () => ({
		description: t('Environment for floating tables.'),
		syntax: t('\\begin{table}[placement]...\\end{table}'),
		example: t(
			'\\begin{table}[ht]\n\\centering\n\\begin{tabular}{cc}\n...\n\\end{tabular}\n\\caption{A table}\n\\label{tab:example}\n\\end{table}',
		),
	}),
	tabular: () => ({
		description: t('Environment for creating tables.'),
		syntax: t('\\begin{tabular}{columns}...\\end{tabular}'),
		example: t(
			'\\begin{tabular}{|l|c|r|}\n\\hline\nLeft & Center & Right \\\\\n\\hline\n\\end{tabular}',
		),
	}),
	itemize: () => ({
		description: t('Environment for bulleted lists.'),
		syntax: '\\begin{itemize}...\\end{itemize}',
		example: t(
			'\\begin{itemize}\n\\item First item\n\\item Second item\n\\end{itemize}',
		),
	}),
	enumerate: () => ({
		description: t('Environment for numbered lists.'),
		syntax: '\\begin{enumerate}...\\end{enumerate}',
		example: t(
			'\\begin{enumerate}\n\\item First item\n\\item Second item\n\\end{enumerate}',
		),
	}),
	equation: () => ({
		description: t('Environment for numbered equations.'),
		syntax: '\\begin{equation}...\\end{equation}',
		example: '\\begin{equation}\nE = mc^2\n\\end{equation}',
	}),
	'equation*': () => ({
		description: t('Environment for unnumbered equations.'),
		syntax: '\\begin{equation*}...\\end{equation*}',
		example: '\\begin{equation*}\nE = mc^2\n\\end{equation*}',
	}),
	align: () => ({
		description: t(
			'Environment for aligning multiple equations, with equation numbers.',
		),
		syntax: '\\begin{align}...\\end{align}',
		example: '\\begin{align}\na &= b \\\\\nc &= d\n\\end{align}',
		package: 'amsmath',
	}),
	'align*': () => ({
		description: t(
			'Environment for aligning multiple equations, without equation numbers.',
		),
		syntax: '\\begin{align*}...\\end{align*}',
		example: '\\begin{align*}\na &= b \\\\\nc &= d\n\\end{align*}',
		package: 'amsmath',
	}),
	verbatim: () => ({
		description: t(
			'Environment for verbatim text, where LaTeX commands are not processed.',
		),
		syntax: '\\begin{verbatim}...\\end{verbatim}',
		example: t('\\begin{verbatim}\nThis is verbatim text.\n\\end{verbatim}'),
	}),
	center: () => ({
		description: t('Environment for centering text.'),
		syntax: '\\begin{center}...\\end{center}',
		example: t('\\begin{center}\nCentered text\n\\end{center}'),
	}),
	tikzpicture: () => ({
		description: t('Environment for creating TikZ pictures.'),
		syntax: '\\begin{tikzpicture}...\\end{tikzpicture}',
		example: '\\begin{tikzpicture}\n\\draw (0,0) -- (1,1);\n\\end{tikzpicture}',
		package: 'tikz',
	}),
};
