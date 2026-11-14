// src/services/BibMetadataService.ts
// A work's metadata from its identifier, asked of open services from the
// browser (all answer CORS): Crossref for a DOI, else doi.org (DataCite,
// mEDRA… as the DOI's agency), doi.org for an arXiv number (arXiv's DataCite
// DOI, 10.48550/arXiv.…), Crossref then Open Library for an ISBN. Only the
// identifier is sent.
import type { BibIdentifier } from '../utils/bibIdentifiers';
import { isbn13 } from '../utils/bibIdentifiers';
import {
	arxivCategory,
	fromCsl,
	fromOpenLibrary,
	type WorkMetadata,
} from '../utils/bibFromMetadata';

const CSL = 'application/vnd.citationstyles.csl+json';
const TIMEOUT_MS = 15000;

/** Why a lookup failed; its message is an English translation key. */
export class LookupError extends Error {
	constructor(
		message: string,
		readonly service: string,
		readonly status?: number,
	) {
		super(message);
	}
}

export const LOOKUP_ERRORS = {
	unreachable: '{service} could not be reached: check the connection',
	slow: '{service} did not answer in time',
	failed: '{service} could not answer ({status})',
} as const;

type Fetch = typeof fetch;

// JSON, or null when the service does not know the identifier.
async function getJson(
	url: string,
	service: string,
	accept: string | undefined,
	fetchImpl: Fetch,
): Promise<Record<string, unknown> | null> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
	let response: Response;
	try {
		response = await fetchImpl(url, {
			headers: accept ? { Accept: accept } : undefined,
			signal: controller.signal,
		});
	} catch {
		throw new LookupError(
			controller.signal.aborted
				? LOOKUP_ERRORS.slow
				: LOOKUP_ERRORS.unreachable,
			service,
		);
	} finally {
		clearTimeout(timer);
	}
	if (response.status === 404 || response.status === 204) return null;
	if (!response.ok) {
		throw new LookupError(LOOKUP_ERRORS.failed, service, response.status);
	}
	try {
		const data = await response.json();
		return data && typeof data === 'object'
			? (data as Record<string, unknown>)
			: null;
	} catch {
		// Not JSON: a DOI whose agency gives no metadata.
		return null;
	}
}

const encodeDoi = (doi: string) =>
	doi.split('/').map(encodeURIComponent).join('/');
const doiUrl = (doi: string) => `https://doi.org/${encodeDoi(doi)}`;

async function lookUpIsbn(
	isbn: string,
	fetchImpl: Fetch,
): Promise<WorkMetadata | null> {
	const crossref = getJson(
		`https://api.crossref.org/works?rows=1&filter=isbn:${isbn13(isbn)},type:book,type:monograph,type:edited-book,type:reference-book`,
		'Crossref',
		undefined,
		fetchImpl,
	).catch(() => null);
	const openLibrary = getJson(
		`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`,
		'Open Library',
		undefined,
		fetchImpl,
	);
	// Crossref's books (most academic ones) come with their DOI and series.
	const found = ((await crossref)?.message as { items?: unknown[] } | undefined)
		?.items?.[0];
	if (found && typeof found === 'object') {
		const meta = fromCsl(found as Record<string, unknown>);
		openLibrary.catch(() => null);
		return { ...meta, isbn: meta.isbn ?? isbn };
	}
	const record = (await openLibrary)?.[`ISBN:${isbn}`];
	return record && typeof record === 'object'
		? fromOpenLibrary(record as Record<string, unknown>, isbn)
		: null;
}

/** The work an identifier names, or null when no service knows it. */
export async function lookUpIdentifier(
	identifier: BibIdentifier,
	fetchImpl: Fetch = (...args) => fetch(...args),
): Promise<WorkMetadata | null> {
	if (identifier.kind === 'isbn') return lookUpIsbn(identifier.id, fetchImpl);
	if (identifier.kind === 'arxiv') {
		const csl = await getJson(
			doiUrl(`10.48550/arXiv.${identifier.id}`),
			'doi.org',
			CSL,
			fetchImpl,
		);
		if (!csl) return null;
		return {
			...fromCsl(csl),
			arxiv: { id: identifier.id, primaryClass: arxivCategory(csl) },
		};
	}
	// Crossref's own record first: a chapter's book, not only its series.
	const crossref = await getJson(
		`https://api.crossref.org/works/${encodeDoi(identifier.id)}`,
		'Crossref',
		undefined,
		fetchImpl,
	).catch(() => null);
	const work = crossref?.message;
	// Another agency's DOI (DataCite, mEDRA, JaLC…) from doi.org.
	const csl =
		work && typeof work === 'object'
			? (work as Record<string, unknown>)
			: await getJson(doiUrl(identifier.id), 'doi.org', CSL, fetchImpl);
	if (!csl) return null;
	const meta = fromCsl(csl);
	// DOIs ignore case: the one typed, as typed.
	return meta.doi?.toLowerCase() === identifier.id.toLowerCase()
		? { ...meta, doi: identifier.id }
		: meta;
}
