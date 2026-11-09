import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { typst_lezer, typstLezerDiagnostics } from 'codemirror-lang-typst/lezer';

import en from '../../../../translations/locales/en.json';
import fr from '../../../../translations/locales/fr.json';

// The interface in French or in English, from the translation files.
let language: 'fr' | 'en' = 'fr';
jest.mock('@/i18n', () => ({
	t: (key: string, options: Record<string, string> = {}) => {
		const texts = (language === 'fr' ? fr : en) as Record<string, string>;
		return (texts[key] ?? key).replace(
			/\{\{(\w+)\}\}/g,
			(_, name) => options[name] ?? '',
		);
	},
}));

// The LaTeX and BibTeX packages are ES modules only, which Jest maps to a
// mock: the lookups their tooltips use, as the package has them. Finding
// the nodes under the mouse is checked in the browser.
jest.mock('codemirror-lang-latex', () => ({
	commandIndex: new Map([
		['\\alpha', { name: '\\alpha', detail: 'α', math: true }],
		['\\vspace', { name: '\\vspace', template: '\\vspace{}' }],
	]),
	environmentIndex: new Map([['pmatrix', { name: 'pmatrix', math: true, package: 'amsmath' }]]),
}));

import { bibtexMessage } from '@src/extensions/codemirror/BibtexCheckExtension';
import { bibtexDocElement } from '@src/extensions/codemirror/languageDocs/bibtexDocs';
import {
	BIBTEX_ENTRY_TYPE_DOCS,
	BIBTEX_FIELD_DOCS,
} from '@src/extensions/codemirror/languageDocs/bibtexDocsData';
import {
	commandDoc,
	environmentDoc,
	latexDocElement,
} from '@src/extensions/codemirror/languageDocs/latexDocs';
import {
	LATEX_COMMAND_DOCS,
	LATEX_ENVIRONMENT_DOCS,
} from '@src/extensions/codemirror/languageDocs/latexDocsData';
import { typstMessage } from '@src/extensions/codemirror/languages/typstSyntaxCheck';

afterEach(() => {
	language = 'fr';
});

describe('LaTeX hover docs', () => {
	it('describes a command in French, its syntax with French placeholders', () => {
		const doc = commandDoc('\\section')!;
		expect(doc.description).toBe("Crée le titre d'une section.");
		const text = latexDocElement(doc).textContent;
		expect(text).toContain('Syntaxe : \\section[titre court]{titre}');
		expect(text).toContain('Exemple : \\section{Introduction}');
	});

	it('describes an environment', () => {
		expect(environmentDoc('figure')?.description).toBe(
			'Environnement des figures flottantes.',
		);
		expect(latexDocElement(environmentDoc('pmatrix')!).textContent).toBe(
			'Environnement mathématique.Syntaxe : \\begin{pmatrix}...\\end{pmatrix}Paquet : amsmath',
		);
	});

	it('names the other commands in French too', () => {
		expect(commandDoc('\\alpha')?.description).toBe('Symbole mathématique α');
		expect(commandDoc('\\vspace')?.description).toBe('Commande LaTeX.');
		expect(commandDoc('\\nimporte')).toBeNull();
		expect(commandDoc('constructor')).toBeNull();
		expect(latexDocElement(commandDoc('\\frac')!).textContent).toContain(
			'Paquet : amsmath (facultatif)',
		);
	});

	it('says everything in English for an English interface', () => {
		language = 'en';
		const text = latexDocElement(commandDoc('\\section')!).textContent;
		expect(text).toBe(
			'Creates a section heading.Syntax: \\section[short title]{title}Example: \\section{Introduction}',
		);
	});

	it('gives every description in French', () => {
		const docs = [
			...Object.values(LATEX_COMMAND_DOCS),
			...Object.values(LATEX_ENVIRONMENT_DOCS),
			...Object.values(BIBTEX_ENTRY_TYPE_DOCS),
			...Object.values(BIBTEX_FIELD_DOCS),
		];
		language = 'en';
		const english = docs.map((make) => make().description);
		language = 'fr';
		const french = docs.map((make) => make().description);
		expect(docs.length).toBe(23 + 13 + 14 + 30);
		expect(french.filter((text, i) => text === english[i])).toEqual([]);
	});
});

describe('BibTeX hover docs', () => {
	it('describes an entry type, with its fields', () => {
		const text = bibtexDocElement({
			kind: 'type',
			name: 'article',
			doc: BIBTEX_ENTRY_TYPE_DOCS.article(),
		}).textContent;
		expect(text).toContain('Un article paru dans une revue ou un magazine.');
		expect(text).toContain('Obligatoires : author, title, journal, year');
		expect(text).toContain('Facultatifs : volume');
		expect(text).toContain('Exemple :@article{cle,');
	});

	it('describes a field, with its note', () => {
		const text = bibtexDocElement({
			kind: 'field',
			name: 'author',
			doc: BIBTEX_FIELD_DOCS.author(),
		}).textContent;
		expect(text).toContain("Le nom de l'auteur ou des auteurs.");
		expect(text).toContain('Exemple : Jean Tremblay and Marie Gagnon');
		expect(text).toContain('Remarque : Séparez les auteurs par « and »');
	});
});

describe('BibTeX check', () => {
	// Each message the bundled linter writes (codemirror-lang-bib, bibtexLinter).
	const english = [
		'Syntax error',
		'Duplicate name in author: Jean Tremblay',
		'Unknown entry type: @nimporte',
		'Duplicate entry key: cle',
		"Duplicate field 'title' in entry",
		'Unknown field: couleur',
		"Syntax error in value for field 'title'",
		"Empty value for field 'year'",
		"Verify 'conf2023' provides: booktitle, year",
		'Missing required fields: journaltitle or journal, date or year',
		'Recommended fields missing: doi',
	];

	it('says each of its problems in French', () => {
		const french = english.map(bibtexMessage);
		expect(french.filter((text, i) => text === english[i])).toEqual([]);
		expect(french).toEqual([
			'Erreur de syntaxe',
			'Nom en double dans author : Jean Tremblay',
			"Type d'entrée inconnu : @nimporte",
			"Clé d'entrée en double : cle",
			"Champ « title » en double dans l'entrée",
			'Champ inconnu : couleur',
			'Erreur de syntaxe dans la valeur du champ « title »',
			'Valeur vide pour le champ « year »',
			'Vérifiez que « conf2023 » fournit : booktitle, year',
			'Champs obligatoires manquants : journaltitle ou journal, date ou year',
			'Champs recommandés manquants : doi',
		]);
	});

	it('keeps them in English for an English interface', () => {
		language = 'en';
		expect(english.map(bibtexMessage)).toEqual(english);
	});
});

describe('Typst syntax check', () => {
	it('says its syntax errors in French', () => {
		const doc = '#let x = [contenu non fermé\n#f(1 2)\n= Titre <etiquette\n';
		const state = EditorState.create({ doc, extensions: [typst_lezer()] });
		ensureSyntaxTree(state, doc.length, 5000);
		const english = typstLezerDiagnostics(state).map((d) => d.message);
		expect(english.length).toBeGreaterThan(0);
		const french = english.map(typstMessage);
		expect(french.filter((text, i) => text === english[i])).toEqual([]);
	});

	it('names an unexpected token', () => {
		expect(typstMessage('Unexpected token `]`.')).toBe('Élément inattendu : `]`.');
	});
});
