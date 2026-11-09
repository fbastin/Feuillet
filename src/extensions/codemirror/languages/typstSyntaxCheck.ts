// src/extensions/codemirror/languages/typstSyntaxCheck.ts
// The Typst syntax check of codemirror-lang-typst (typstLezerLinter), with
// its messages in the user's language: it writes them in English. Each
// fixed message is its own translation key.
import { type Diagnostic, linter } from '@codemirror/lint';
import { typstLezerDiagnostics } from 'codemirror-lang-typst/lezer';

import { t } from '@/i18n';

const UNEXPECTED_TOKEN = /^Unexpected token `(.+)`\.$/;

export const typstMessage = (message: string): string => {
	const unexpected = UNEXPECTED_TOKEN.exec(message);
	if (unexpected)
		return t('Unexpected token `{token}`.', { token: unexpected[1] });
	return t(message);
};

export const typstSyntaxCheck = linter((view): Diagnostic[] =>
	typstLezerDiagnostics(view.state).map((diagnostic) => ({
		...diagnostic,
		message: typstMessage(diagnostic.message),
		source:
			diagnostic.source === 'Typst syntax'
				? t('Typst syntax')
				: diagnostic.source,
	})),
);
