// src/extensions/codemirror/LatexCodeCheckExtension.ts
// Overleaf's code check in the editor: the mistakes in the structure of the
// file (utils/latexCodeCheck), and those checks of the bundled LaTeX linter
// that hold in a project of several files, in the user's language. The
// bundled checks of labels, citations and \begin{document} are left out:
// in a chapter, these are in other files.
import { type Diagnostic, linter } from '@codemirror/lint';
import type { Extension } from '@codemirror/state';
import { latexLinter, mathOnlyCommands } from 'codemirror-lang-latex';

import { t } from '@/i18n';
import { type CodeProblem, checkLatexCode } from '../../utils/latexCodeCheck';
import { maskAnnotationText } from './annotations/annotationMasking';

const problemMessage = ({ kind, command, closing }: CodeProblem): string => {
	switch (kind) {
		case 'unclosed':
			return t('{command} is not closed', { command });
		case 'closedBy':
			return t('{command} is closed by {closing}', { command, closing });
		case 'closesNothing':
			return t('{command} closes nothing', { command });
		case 'paragraphEnd':
			return t('{command} is not closed before the end of the paragraph', {
				command,
			});
		case 'blankLineInMath':
			return t('A blank line is not allowed in {command}', { command });
		case 'mathOnly':
			return t('{command} must be in math mode', { command });
		case 'notAllowedInMath':
			return t('{command} is not allowed in math mode', { command });
		case 'missing':
			return t('{command} is missing', { command });
	}
};

// What the bundled linter suggests instead of an obsolete command.
const replacementText = (text: string): string => {
	let match = /^the (\S+) environment from (\S+)$/.exec(text);
	if (match) {
		return t('the {name} environment of {package}', {
			name: match[1],
			package: match[2],
		});
	}
	match = /^the (\S+) environment$/.exec(text);
	if (match) return t('the {name} environment', { name: match[1] });
	match = /^the (\S+) package$/.exec(text);
	if (match) return t('the {name} package', { name: match[1] });
	return text.split(' or ').join(` ${t('or')} `);
};

// The bundled linter's messages, which are in English.
const BUNDLED_MESSAGES: [RegExp, (match: RegExpExecArray) => string][] = [
	[
		/^Duplicate label: (.+)$/,
		(match) => t('Duplicate label: {label}', { label: match[1] }),
	],
	[
		/^The (\S+) environment is obsolete; use (.+)$/,
		(match) =>
			t('The {name} environment is obsolete: use {replacement}', {
				name: match[1],
				replacement: replacementText(match[2]),
			}),
	],
	[
		/^(\\\S+) is obsolete; use (.+)$/,
		(match) =>
			t('{command} is obsolete: use {replacement}', {
				command: match[1],
				replacement: replacementText(match[2]),
			}),
	],
	[
		/^\$\$\.\.\.\$\$ is obsolete/,
		// No dots in the key: i18next would read it as a path.
		() =>
			t(
				"TeX's $$ is obsolete in LaTeX: use \\[ \\] or the equation* environment",
			),
	],
	[
		/^The (\S+) environment requires (.+)$/,
		(match) =>
			t('The {name} environment requires {package}', {
				name: match[1],
				package: match[2],
			}),
	],
	[
		/^(\\\S+) requires (.+)$/,
		(match) =>
			t('{command} requires {package}', {
				command: match[1],
				package: match[2],
			}),
	],
];

const bundledMessage = (message: string): string => {
	for (const [pattern, translate] of BUNDLED_MESSAGES) {
		const match = pattern.exec(message);
		if (match) return translate(match);
	}
	return message;
};

export function createLatexCodeCheck(fileName?: string): Extension {
	// Packages and classes are code for TeX itself.
	if (fileName && /\.(sty|cls|dtx|ltx|def)$/i.test(fileName)) return [];

	const bundled = latexLinter({
		fileName,
		checkMissingDocumentEnv: false,
		checkUnmatchedEnvironments: false,
		checkUnclosedBraces: false,
		checkMissingReferences: false,
		checkCitesWithoutBibliography: false,
		checkMathModeCommands: false,
	});

	return linter((view): Diagnostic[] => {
		const source = t('Code check');
		// Comment and change tags are not LaTeX.
		const text = maskAnnotationText(view.state);
		const own = checkLatexCode(text, mathOnlyCommands).map((problem) => ({
			from: problem.from,
			to: problem.to,
			severity: problem.severity,
			message: problemMessage(problem),
			source,
		}));
		const others = bundled(view).map((diagnostic) => ({
			...diagnostic,
			message: bundledMessage(diagnostic.message),
			source,
		}));
		return [...own, ...others];
	});
}
