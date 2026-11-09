// src/extensions/codemirror/languageDocs/bibtexDocsData.ts
// The descriptions the BibTeX language package shows on hover
// (codemirror-lang-bib, entryTypeInfoMap and fieldInfoMap), in the user's
// language: the English text is the translation key. Field names stay as
// BibTeX spells them.
import { t } from '@/i18n';

export interface BibtexEntryTypeDoc {
	description: string;
	requiredFields: string[];
	optionalFields: string[];
	example?: string;
}

export interface BibtexFieldDoc {
	description: string;
	example?: string;
	note?: string;
}

export const BIBTEX_ENTRY_TYPE_DOCS: Record<string, () => BibtexEntryTypeDoc> =
	{
		article: () => ({
			description: t('An article published in a journal or magazine.'),
			requiredFields: ['author', 'title', 'journal', 'year'],
			optionalFields: [
				'volume',
				'number',
				'pages',
				'month',
				'note',
				'doi',
				'url',
			],
			example: t(
				'@article{key,\n  author = {John Doe},\n  title = {Sample Article},\n  journal = {Journal Name},\n  year = {2023}\n}',
			),
		}),
		book: () => ({
			description: t('A complete book published by a publisher.'),
			requiredFields: ['author', 'title', 'publisher', 'year'],
			optionalFields: [
				'volume',
				'series',
				'address',
				'edition',
				'month',
				'note',
				'isbn',
			],
			example: t(
				'@book{key,\n  author = {Jane Smith},\n  title = {Book Title},\n  publisher = {Publisher},\n  year = {2023}\n}',
			),
		}),
		inproceedings: () => ({
			description: t('A paper published in conference proceedings.'),
			requiredFields: ['author', 'title', 'booktitle', 'year'],
			optionalFields: [
				'editor',
				'pages',
				'organization',
				'publisher',
				'address',
				'month',
				'note',
			],
			example: t(
				'@inproceedings{key,\n  author = {Author Name},\n  title = {Paper Title},\n  booktitle = {Conference Proceedings},\n  year = {2023}\n}',
			),
		}),
		incollection: () => ({
			description: t('A part of a book with its own title.'),
			requiredFields: ['author', 'title', 'booktitle', 'publisher', 'year'],
			optionalFields: [
				'editor',
				'pages',
				'chapter',
				'address',
				'month',
				'note',
			],
		}),
		conference: () => ({
			description: t(
				'Same as inproceedings - a paper in conference proceedings.',
			),
			requiredFields: ['author', 'title', 'booktitle', 'year'],
			optionalFields: [
				'editor',
				'pages',
				'organization',
				'publisher',
				'address',
				'month',
				'note',
			],
		}),
		phdthesis: () => ({
			description: t('A doctoral dissertation.'),
			requiredFields: ['author', 'title', 'school', 'year'],
			optionalFields: ['address', 'month', 'note', 'type'],
		}),
		mastersthesis: () => ({
			description: t("A master's thesis."),
			requiredFields: ['author', 'title', 'school', 'year'],
			optionalFields: ['address', 'month', 'note', 'type'],
		}),
		techreport: () => ({
			description: t('A technical report published by an institution.'),
			requiredFields: ['author', 'title', 'institution', 'year'],
			optionalFields: ['type', 'number', 'address', 'month', 'note'],
		}),
		manual: () => ({
			description: t('Technical documentation or manual.'),
			requiredFields: ['title'],
			optionalFields: [
				'author',
				'organization',
				'address',
				'edition',
				'month',
				'year',
				'note',
			],
		}),
		misc: () => ({
			description: t("For items that don't fit other categories."),
			requiredFields: ['title'],
			optionalFields: [
				'author',
				'howpublished',
				'month',
				'year',
				'note',
				'url',
			],
		}),
		online: () => ({
			description: t('An online resource or webpage.'),
			requiredFields: ['title', 'url'],
			optionalFields: ['author', 'year', 'month', 'urldate', 'note'],
		}),
		unpublished: () => ({
			description: t('A document that has not been published.'),
			requiredFields: ['author', 'title', 'note'],
			optionalFields: ['month', 'year'],
		}),
		booklet: () => ({
			description: t('A printed work without a named publisher.'),
			requiredFields: ['title'],
			optionalFields: [
				'author',
				'howpublished',
				'address',
				'month',
				'year',
				'note',
			],
		}),
		proceedings: () => ({
			description: t('The proceedings of a conference.'),
			requiredFields: ['title', 'year'],
			optionalFields: [
				'editor',
				'publisher',
				'organization',
				'address',
				'month',
				'note',
			],
		}),
	};

export const BIBTEX_FIELD_DOCS: Record<string, () => BibtexFieldDoc> = {
	author: () => ({
		description: t('The name(s) of the author(s).'),
		example: t('John Doe and Jane Smith'),
		note: t('Use "and" to separate multiple authors'),
	}),
	title: () => ({
		description: t('The title of the work.'),
		example: t('A Great Discovery in Science'),
	}),
	journal: () => ({
		description: t('The name of the journal or magazine.'),
		example: 'Nature',
	}),
	year: () => ({ description: t('The year of publication.'), example: '2023' }),
	publisher: () => ({
		description: t('The name of the publisher.'),
		example: 'Academic Press',
	}),
	booktitle: () => ({
		description: t('The title of the book or conference proceedings.'),
		example: t('Proceedings of the International Conference'),
	}),
	editor: () => ({
		description: t('The name(s) of the editor(s).'),
		example: t('John Editor and Jane Editor'),
		note: t('Use "and" to separate multiple editors'),
	}),
	pages: () => ({
		description: t('The page numbers.'),
		example: '123--145',
		note: t('Use double dash (--) for page ranges'),
	}),
	volume: () => ({
		description: t('The volume number of a journal or book.'),
		example: '42',
	}),
	number: () => ({
		description: t('The issue number of a journal.'),
		example: '3',
	}),
	month: () => ({
		description: t('The month of publication.'),
		example: 'jan',
		note: t('Use three-letter abbreviations without quotes'),
	}),
	note: () => ({
		description: t('Any additional information.'),
		example: t('In press'),
	}),
	doi: () => ({
		description: t('Digital Object Identifier.'),
		example: '10.1000/182',
	}),
	url: () => ({
		description: t('The URL of an online resource.'),
		example: 'https://example.com/paper.pdf',
	}),
	urldate: () => ({
		description: t('The date when the URL was last accessed.'),
		example: '2023-12-01',
	}),
	address: () => ({
		description: t('The address of the publisher or institution.'),
		example: t('New York, NY'),
	}),
	edition: () => ({
		description: t('The edition of a book.'),
		example: t('2nd'),
	}),
	series: () => ({
		description: t('The name of a series or set of books.'),
		example: 'Lecture Notes in Computer Science',
	}),
	school: () => ({
		description: t('The name of the school where a thesis was written.'),
		example: t('MIT'),
	}),
	institution: () => ({
		description: t('The institution that published a technical report.'),
		example: t('Stanford University'),
	}),
	organization: () => ({
		description: t('The organization that sponsored a conference.'),
		example: 'IEEE',
	}),
	type: () => ({
		description: t('The type of technical report or thesis.'),
		example: t('PhD thesis'),
	}),
	howpublished: () => ({
		description: t('How something unusual has been published.'),
		example: t('Self-published'),
	}),
	chapter: () => ({ description: t('The chapter number.'), example: '7' }),
	key: () => ({
		description: t('Used for alphabetizing when author is missing.'),
		example: 'Anonymous99',
	}),
	crossref: () => ({
		description: t('The key of another entry to inherit fields from.'),
		example: 'conf2023',
	}),
	isbn: () => ({
		description: t('International Standard Book Number.'),
		example: '978-0-123456-78-9',
	}),
	issn: () => ({
		description: t('International Standard Serial Number.'),
		example: '1234-5678',
	}),
	keywords: () => ({
		description: t('Keywords associated with the entry.'),
		example: t('machine learning, artificial intelligence'),
	}),
	abstract: () => ({
		description: t('Abstract or summary of the work.'),
		example: t('This paper presents...'),
	}),
};
