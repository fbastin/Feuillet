// src/utils/bibPreview.ts
// An entry as a reference list would print it, as JabRef's preview: the
// authors, the year, the title, where it was published. Pieces, not HTML,
// so nothing from the file is read as markup.
import { t } from '@/i18n';

import {
	type BibDocument,
	type BibEntry,
	fieldText,
	findField,
} from './bibDocument';
import { displayText } from './referenceSearch';

export interface PreviewPiece {
	text: string;
	style?: 'italic' | 'link';
	href?: string;
}

/** Names of an « and » list, at brace depth 0 (« {Barnes and Noble} » is one). */
export function splitNames(field: string): string[] {
	const names: string[] = [];
	let depth = 0;
	let start = 0;
	const lower = field.toLowerCase();
	for (let i = 0; i < field.length; i++) {
		const char = field[i];
		if (char === '{') depth++;
		else if (char === '}') depth--;
		else if (
			depth === 0 &&
			/\s/.test(char) &&
			lower.startsWith('and', i + 1) &&
			/\s/.test(field[i + 4] ?? '')
		) {
			names.push(field.slice(start, i));
			start = i + 4;
			i += 3;
		}
	}
	names.push(field.slice(start));
	return names.map((name) => name.trim()).filter(Boolean);
}

/** « Last, First », « Last, Jr, First » or « First Last » as « First Last ». */
export function displayName(name: string): string {
	const parts: string[] = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i < name.length; i++) {
		if (name[i] === '{') depth++;
		else if (name[i] === '}') depth--;
		else if (name[i] === ',' && depth === 0) {
			parts.push(name.slice(start, i).trim());
			start = i + 1;
		}
	}
	parts.push(name.slice(start).trim());
	let written = name;
	if (parts.length === 2) written = `${parts[1]} ${parts[0]}`;
	else if (parts.length >= 3) written = `${parts[2]} ${parts[0]}, ${parts[1]}`;
	return displayText(written);
}

/** « A. Author, B. Author and C. Author », « A. Author et al. ». */
export function displayNames(field: string): string {
	const names = splitNames(field);
	const others =
		names.length > 0 && names[names.length - 1].toLowerCase() === 'others';
	const shown = (others ? names.slice(0, -1) : names).map(displayName);
	if (others) return `${shown.join(', ')} ${t('et al.')}`;
	if (shown.length <= 1) return shown.join('');
	return `${shown.slice(0, -1).join(', ')} ${t('and')} ${shown[shown.length - 1]}`;
}

/** What the preview shows of an entry. */
export function previewEntry(
	document: BibDocument,
	entry: BibEntry,
): PreviewPiece[] {
	const raw = (...names: string[]): string => {
		for (const name of names) {
			const value = fieldText(document, findField(entry, name)).trim();
			if (value) return value;
		}
		return '';
	};
	const text = (...names: string[]) => displayText(raw(...names));
	const type = entry.type.toLowerCase();
	const pieces: PreviewPiece[] = [];
	const add = (value: string, style?: PreviewPiece['style']) => {
		if (value) pieces.push({ text: value, style });
	};
	const sentence = (value: string, style?: PreviewPiece['style']) => {
		if (!value) return;
		add(value, style);
		add(/[.?!]$/.test(value) ? ' ' : '. ');
	};

	const authors = raw('author');
	const editors = raw('editor');
	const year = raw('year') || (/^\d{4}/.exec(raw('date'))?.[0] ?? '');
	const editorLabel = (field: string) =>
		splitNames(field).length > 1 ? t('eds.') : t('ed.');

	if (authors) add(displayNames(authors));
	else if (editors) add(`${displayNames(editors)} (${editorLabel(editors)})`);
	if (year) add(`${authors || editors ? ' ' : ''}(${year})`);
	if (authors || editors || year) add('. ');

	const title = text('title');
	const container = text('journaltitle', 'journal');
	const bookTitle = text('booktitle');
	const isPart = Boolean(container || bookTitle);
	sentence(title, isPart ? undefined : 'italic');

	if (container) {
		add(container, 'italic');
		const volume = text('volume');
		const number = text('number', 'issue');
		if (volume) add(`, ${volume}`);
		if (number) add(volume ? `(${number})` : `, ${number}`);
		const pages = text('pages');
		if (pages) add(`, ${pages}`);
		add('. ');
	} else if (bookTitle) {
		add(`${t('In')} `);
		if (editors && authors) {
			add(`${displayNames(editors)} (${editorLabel(editors)}), `);
		}
		add(bookTitle, 'italic');
		const pages = text('pages');
		if (pages) add(` (${t('pp.')} ${pages})`);
		add('. ');
	}

	const thesisType = (() => {
		if (type === 'phdthesis') return t('PhD thesis');
		if (type === 'mastersthesis') return t("Master's thesis");
		if (type === 'techreport') return t('Technical report');
		if (type === 'thesis' || type === 'report') {
			const written = text('type');
			if (written === 'phdthesis') return t('PhD thesis');
			if (written === 'mathesis') return t("Master's thesis");
			if (written === 'techreport') return t('Technical report');
			return written;
		}
		return '';
	})();
	if (thesisType) {
		const number =
			type === 'techreport' || type === 'report' ? text('number') : '';
		sentence(number ? `${thesisType} ${number}` : thesisType);
	}

	const edition = text('edition');
	if (edition) {
		sentence(
			/^\d+$/.test(edition)
				? t('Edition {number}', { number: edition })
				: edition,
		);
	}
	const howPublished = text('howpublished');
	if (howPublished) sentence(howPublished);
	const publisherParts = [
		text('publisher', 'school', 'institution', 'organization'),
		text('location', 'address'),
	].filter(Boolean);
	sentence(publisherParts.join(', '));
	sentence(text('note'));

	const doi = raw('doi').replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
	const url = raw('url');
	if (doi) {
		add('DOI ');
		pieces.push({ text: doi, style: 'link', href: `https://doi.org/${doi}` });
		add(' ');
	}
	if (url && /^https?:\/\//i.test(url)) {
		pieces.push({ text: url, style: 'link', href: url });
	}

	// No trailing space.
	const last = pieces[pieces.length - 1];
	if (last && !last.style) last.text = last.text.trimEnd();
	return pieces.filter((piece) => piece.text);
}
