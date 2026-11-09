import { findLatexDefinitions } from '@src/utils/latexDefinitions';

const commands = (text: string) =>
	Object.fromEntries(findLatexDefinitions(text).commands.map((c) => [c.name, c.args]));
const environments = (text: string) =>
	Object.fromEntries(
		findLatexDefinitions(text).environments.map((e) => [e.name, e.args]),
	);

describe('findLatexDefinitions', () => {
	it('finds \\newcommand and its kin, with their arguments in braces', () => {
		expect(
			commands(String.raw`
\newcommand{\R}{\mathbb{R}}
\newcommand\norme[1]{\lVert #1 \rVert}
\renewcommand*{\vecteur}[2]{(#1, #2)}
\providecommand{\abs}[1]{|#1|}
\newcommand{\avecdefaut}[3][x]{#1 #2 #3}
\DeclareRobustCommand{\robuste}{}
`),
		).toEqual({
			'\\R': 0,
			'\\norme': 1,
			'\\vecteur': 2,
			'\\abs': 1,
			'\\avecdefaut': 2,
			'\\robuste': 0,
		});
	});

	it('finds operators, paired delimiters, \\def, \\let and xparse commands', () => {
		expect(
			commands(String.raw`
\DeclareMathOperator{\Tr}{Tr}
\DeclareMathOperator*{\argmax}{arg\,max}
\DeclarePairedDelimiter{\ceil}{\lceil}{\rceil}
\def\produit#1#2{#1 \cdot #2}
\gdef\global{}
\let\ancien\section
\NewDocumentCommand{\paire}{O{a} m m}{(#2, #3)}
\NewDocumentCommand\etoile{s m}{#2}
`),
		).toEqual({
			'\\Tr': 0,
			'\\argmax': 0,
			'\\ceil': 1,
			'\\produit': 2,
			'\\global': 0,
			'\\ancien': 0,
			'\\paire': 2,
			'\\etoile': 1,
		});
	});

	it('finds environments and theorems', () => {
		expect(
			environments(String.raw`
\newenvironment{encadre}{\begin{center}}{\end{center}}
\renewenvironment{titre}[1]{#1}{}
\NewDocumentEnvironment{boite}{m o}{}{}
\newtheorem{lemme}{Lemme}[section]
\newtheorem*{remarque}{Remarque}
\declaretheorem[style=definition]{definition}
\newtcolorbox{alerte}[1]{title=#1}
`),
		).toEqual({
			encadre: 0,
			titre: 1,
			boite: 1,
			lemme: 0,
			remarque: 0,
			definition: 0,
			alerte: 1,
		});
	});

	it('leaves out what is commented out, and internal names', () => {
		const text = String.raw`
% \newcommand{\cache}{}
\newcommand{\visible}{} % \newcommand{\apres}{}
100\% \newcommand{\pourcent}{}
\newcommand{\interne@nom}{}
\newcommand\autre@nom{}
`;
		expect(commands(text)).toEqual({ '\\visible': 0, '\\pourcent': 0 });
	});

	it('keeps the first definition of a name', () => {
		expect(
			commands(String.raw`\newcommand{\x}[1]{#1}\renewcommand{\x}[2]{#1#2}`),
		).toEqual({ '\\x': 1 });
	});
});
