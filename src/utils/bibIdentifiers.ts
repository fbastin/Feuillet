// src/utils/bibIdentifiers.ts
// What one pastes to add a reference, as JabRef's « New entry from ID »: a
// DOI (bare, doi:…, or a doi.org link), an arXiv number (new or old style,
// arXiv:…, or an arxiv.org link) or an ISBN (10 or 13, hyphens or not).

export type BibIdentifier =
	| { kind: 'doi'; id: string }
	/** Without its version: « 1706.03762 », « hep-th/9711200 ». */
	| { kind: 'arxiv'; id: string }
	/** Digits only (and X), its check digit right. */
	| { kind: 'isbn'; id: string };

export type ParsedIdentifier =
	| BibIdentifier
	| { kind: 'invalid-isbn'; id: string }
	| null;

const NEW_ARXIV = /^(\d{4}\.\d{4,5})(?:v\d+)?$/;
const OLD_ARXIV = /^([a-z][a-z-]*(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?$/;

/** Whether an ISBN's check digit is right. */
export function isbnValid(isbn: string): boolean {
	if (/^\d{9}[\dX]$/.test(isbn)) {
		let sum = 0;
		for (let i = 0; i < 10; i++) {
			const digit = isbn[i] === 'X' ? 10 : Number(isbn[i]);
			sum += (10 - i) * digit;
		}
		return sum % 11 === 0;
	}
	if (/^97[89]\d{10}$/.test(isbn)) {
		let sum = 0;
		for (let i = 0; i < 13; i++) sum += Number(isbn[i]) * (i % 2 ? 3 : 1);
		return sum % 10 === 0;
	}
	return false;
}

/** An ISBN-10 as ISBN-13 (978…), an ISBN-13 as it is. */
export function isbn13(isbn: string): string {
	if (isbn.length === 13) return isbn;
	const body = `978${isbn.slice(0, 9)}`;
	let sum = 0;
	for (let i = 0; i < 12; i++) sum += Number(body[i]) * (i % 2 ? 3 : 1);
	return `${body}${(10 - (sum % 10)) % 10}`;
}

function arxivId(text: string): string | null {
	const id = text.replace(/^arxiv:\s*/i, '');
	return NEW_ARXIV.exec(id)?.[1] ?? OLD_ARXIV.exec(id)?.[1] ?? null;
}

/** What `input` identifies, or null when it is none of them. */
export function parseIdentifier(input: string): ParsedIdentifier {
	let text = input.trim().replace(/[.,;]+$/, '');
	if (!text) return null;

	// Links: doi.org, arxiv.org.
	const link = /^https?:\/\/(?:www\.|dx\.)?(doi\.org|arxiv\.org)\/(.+)$/i.exec(
		text,
	);
	if (link) {
		const host = link[1].toLowerCase();
		let path = link[2];
		try {
			path = decodeURIComponent(path);
		} catch {
			// Kept as written.
		}
		if (host === 'arxiv.org') {
			const id = arxivId(
				path
					.replace(/^(abs|pdf)\//, '')
					.replace(/\.pdf$/i, '')
					.split(/[?#]/)[0],
			);
			return id ? { kind: 'arxiv', id } : null;
		}
		text = path;
	}

	const doi = /^(?:doi:\s*)?(10\.\d{4,9}\/\S+)$/i.exec(text)?.[1];
	if (doi) {
		// arXiv's own DOIs: an arXiv number, with its category.
		const arxiv = /^10\.48550\/arxiv\.(.+)$/i.exec(doi);
		const id = arxiv ? arxivId(arxiv[1]) : null;
		return id ? { kind: 'arxiv', id } : { kind: 'doi', id: doi };
	}

	const arxiv = arxivId(text);
	if (arxiv) return { kind: 'arxiv', id: arxiv };

	const isbn = /^(?:isbn(?:-1[03])?:?\s*)?([\d\s-]{9,}[\dxX])$/i.exec(
		text,
	)?.[1];
	if (isbn) {
		const digits = isbn.replace(/[\s-]/g, '').toUpperCase();
		if (digits.length !== 10 && digits.length !== 13) return null;
		return isbnValid(digits)
			? { kind: 'isbn', id: digits }
			: { kind: 'invalid-isbn', id: digits };
	}
	return null;
}
