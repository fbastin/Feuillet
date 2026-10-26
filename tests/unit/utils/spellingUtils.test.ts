import {
	declaredLanguage,
	guessLanguage,
	interfaceSpellingLanguage,
	isProse,
	proseWords,
	type SpellingNode,
} from '@src/utils/spellingUtils';

const words = (text: string, before = '', after = '') =>
	proseWords(text, 0, before, after).map(({ word }) => word);

// A Normal text node inside the given ancestors, outermost first.
const textNode = (
	source: string,
	ancestors: Array<string | { name: string; from: number; to: number }>,
	options: { firstArgument?: boolean } = {},
): SpellingNode => {
	let parent: SpellingNode | null = null;
	for (const ancestor of ancestors) {
		const spec =
			typeof ancestor === 'string'
				? { name: ancestor, from: 0, to: source.length }
				: ancestor;
		parent = { ...spec, parent, prevSibling: null };
	}
	const node = { name: 'Normal', from: 0, to: source.length, parent, prevSibling: null };
	if (options.firstArgument && parent) {
		Object.assign(parent, {
			prevSibling: { name: 'TextColorCtrlSeq', from: 0, to: 0, parent: null, prevSibling: null },
		});
	}
	return node;
};

const isProseIn = (source: string, node: SpellingNode) =>
	isProse(node, (from, to) => source.slice(from, to));

describe('proseWords', () => {
	it('keeps French and English words whole', () => {
		expect(words("L'électricité, c'est-à-dire aujourd’hui les chercheur·e·s.")).toEqual([
			"L'électricité",
			"c'est-à-dire",
			'aujourd’hui',
			'les',
			'chercheur·e·s',
		]);
		expect(words("It's state-of-the-art.")).toEqual(["It's", 'state-of-the-art']);
	});

	it('gives positions in the document', () => {
		expect(proseWords('un mot', 10)).toEqual([
			{ from: 10, to: 12, word: 'un' },
			{ from: 13, to: 16, word: 'mot' },
		]);
	});

	it('leaves out what is not prose', () => {
		expect(words('2cm fig:intro www.example.org a@b.ca key=value x_1 chap/intro')).toEqual([]);
		expect(words('NASA LaTeX iPhone à y')).toEqual([]);
		expect(words("L'Europe Jean-Pierre")).toEqual(["L'Europe", 'Jean-Pierre']);
	});

	it('leaves out words split by accent commands', () => {
		expect(words('caf', 'Un ', "\\'e")).toEqual([]);
		expect(words('cole', "\\'", '')).toEqual([]);
		expect(words('ur', '\\oe ', '')).toEqual([]);
		expect(words('note', '', '\\footnote')).toEqual(['note']);
	});
});

describe('isProse', () => {
	it('checks text, sections and footnotes', () => {
		const source = 'Un texte';
		expect(isProseIn(source, textNode(source, ['LaTeX', 'Text']))).toBe(true);
		expect(
			isProseIn(source, textNode(source, ['SectioningCommand', 'SectioningArgument', 'LongArg'])),
		).toBe(true);
		expect(
			isProseIn(source, textNode(source, ['FootnoteCommand', 'TextArgument', 'LongArg'])),
		).toBe(true);
	});

	it('skips math, except \\text in it', () => {
		const source = 'tel que';
		expect(isProseIn(source, textNode(source, ['DollarMath', 'InlineMath', 'Math']))).toBe(false);
		expect(
			isProseIn(
				source,
				textNode(source, ['DollarMath', 'InlineMath', 'Math', 'MathCommand', 'MathTextCommand', 'TextArgument']),
			),
		).toBe(true);
	});

	it('skips labels, citations, packages, comments and code', () => {
		const source = 'intro';
		for (const name of ['Label', 'Ref', 'Cite', 'UsePackage', 'Comment', 'VerbatimEnvironment', 'Author']) {
			expect(isProseIn(source, textNode(source, ['Text', name, 'Argument']))).toBe(false);
		}
	});

	it('checks the optional argument of sections and items only', () => {
		const source = 'court';
		expect(isProseIn(source, textNode(source, ['SectioningCommand', 'OptionalArgument']))).toBe(true);
		expect(isProseIn(source, textNode(source, ['Item', 'OptionalArgument']))).toBe(true);
		expect(isProseIn(source, textNode(source, ['BeginEnv', 'OptionalArgument']))).toBe(false);
		expect(isProseIn(source, textNode(source, ['Cite', 'OptionalArgument']))).toBe(false);
	});

	it('skips the colour of \\textcolor but checks its text', () => {
		const source = 'red';
		expect(
			isProseIn(source, textNode(source, ['TextColorCommand', 'ShortTextArgument'], { firstArgument: true })),
		).toBe(false);
		expect(isProseIn(source, textNode(source, ['TextColorCommand', 'TextArgument']))).toBe(true);
	});

	it('checks arguments of unknown commands only when they hold several words', () => {
		const single = '{empty}';
		const node = (source: string) =>
			textNode(source, ['UnknownCommand', { name: 'TextArgument', from: 0, to: source.length }]);
		expect(isProseIn(single, node(single))).toBe(false);
		expect(isProseIn('{deux mots}', node('{deux mots}'))).toBe(true);
		expect(isProseIn('{margin = 2cm}', node('{margin = 2cm}'))).toBe(false);
	});
});

describe('declaredLanguage', () => {
	it('reads babel, whose last language is the main one', () => {
		expect(declaredLanguage('\\usepackage[french]{babel}')).toBe('fr');
		expect(declaredLanguage('\\usepackage[english,french]{babel}')).toBe('fr');
		expect(declaredLanguage('\\usepackage[french,british]{babel}')).toBe('en-GB');
		expect(declaredLanguage('\\usepackage[main=french,english]{babel}')).toBe('fr');
		expect(declaredLanguage('\\documentclass[12pt,canadien]{article}\n\\usepackage{babel}')).toBe(
			'fr',
		);
	});

	it('reads polyglossia', () => {
		expect(declaredLanguage('\\setmainlanguage{french}')).toBe('fr');
		expect(declaredLanguage('\\setdefaultlanguage[variant=british]{english}')).toBe('en-GB');
	});

	it('tells languages without a dictionary from none at all', () => {
		expect(declaredLanguage('\\usepackage[ngerman]{babel}')).toBeNull();
		expect(declaredLanguage('\\documentclass{article}\n\\usepackage[T1]{fontenc}')).toBeUndefined();
		expect(declaredLanguage('% \\usepackage[french]{babel}\n\\begin{document}')).toBeUndefined();
	});
});

describe('guessLanguage', () => {
	it('recognizes French and English text', () => {
		expect(
			guessLanguage(
				'Le modèle est résolu par une méthode qui utilise les données et la structure du problème pour obtenir des solutions dans un temps raisonnable.',
			),
		).toBe('fr');
		expect(
			guessLanguage(
				'The model is solved with a method that uses the data and the structure of the problem to find solutions in a reasonable time, which is the goal of this work.',
			),
		).toBe('en-US');
		expect(guessLanguage('\\section{Introduction}')).toBeUndefined();
	});
});

describe('interfaceSpellingLanguage', () => {
	it('follows the interface language', () => {
		expect(interfaceSpellingLanguage('fr')).toBe('fr');
		expect(interfaceSpellingLanguage('fr-CA')).toBe('fr');
		expect(interfaceSpellingLanguage('en-GB')).toBe('en-GB');
		expect(interfaceSpellingLanguage('de')).toBe('en-US');
	});
});
