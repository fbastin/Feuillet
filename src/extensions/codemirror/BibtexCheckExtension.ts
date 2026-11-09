// src/extensions/codemirror/BibtexCheckExtension.ts
// The bundled BibTeX linter's checks (codemirror-lang-bib), with its
// messages in the user's language: it writes them in English.
import { type Diagnostic, linter } from '@codemirror/lint';
import type { Extension } from '@codemirror/state';
import { bibtexLinter } from 'codemirror-lang-bib';

import { t } from '@/i18n';

// Fields listed as « date or year » when either will do.
const fieldList = (text: string): string =>
	text.split(' or ').join(` ${t('or')} `);

const MESSAGES: [RegExp, (match: RegExpExecArray) => string][] = [
	[/^Syntax error$/, () => t('Syntax error')],
	[
		/^Syntax error in value for field '(.+)'$/,
		(match) =>
			t("Syntax error in value for field '{field}'", { field: match[1] }),
	],
	[
		/^Duplicate name in ([^:]+): (.+)$/,
		(match) =>
			t('Duplicate name in {field}: {name}', {
				field: match[1],
				name: match[2],
			}),
	],
	[
		/^Unknown entry type: @(.+)$/,
		(match) => t('Unknown entry type: @{type}', { type: match[1] }),
	],
	[
		/^Duplicate entry key: (.+)$/,
		(match) => t('Duplicate entry key: {key}', { key: match[1] }),
	],
	[
		/^Duplicate field '(.+)' in entry$/,
		(match) => t("Duplicate field '{field}' in entry", { field: match[1] }),
	],
	[
		/^Unknown field: (.+)$/,
		(match) => t('Unknown field: {field}', { field: match[1] }),
	],
	[
		/^Empty value for field '(.+)'$/,
		(match) => t("Empty value for field '{field}'", { field: match[1] }),
	],
	[
		/^Verify '(.+)' provides: (.+)$/,
		(match) =>
			t("Verify '{crossref}' provides: {fields}", {
				crossref: match[1],
				fields: fieldList(match[2]),
			}),
	],
	[
		/^Missing required fields: (.+)$/,
		(match) =>
			t('Missing required fields: {fields}', {
				fields: fieldList(match[1]),
			}),
	],
	[
		/^Recommended fields missing: (.+)$/,
		(match) =>
			t('Recommended fields missing: {fields}', {
				fields: fieldList(match[1]),
			}),
	],
];

export const bibtexMessage = (message: string): string => {
	for (const [pattern, translate] of MESSAGES) {
		const match = pattern.exec(message);
		if (match) return translate(match);
	}
	return message;
};

export function createBibtexCheck(): Extension {
	const bundled = bibtexLinter();
	return linter((view): Diagnostic[] =>
		bundled(view).map((diagnostic) => ({
			...diagnostic,
			message: bibtexMessage(diagnostic.message),
		})),
	);
}
