// src/extensions/codemirror/autocomplete/latexDefinitionsCompletion.ts
// The project's own commands and environments in the autocompletion, as on
// Overleaf: what \newcommand, \DeclareMathOperator, \newenvironment,
// \newtheorem… define in this file (as it is now) and in the project's
// other LaTeX files. Each argument in braces is a field to fill, Tab to
// the next.
import {
	type Completion,
	type CompletionContext,
	type CompletionResult,
	type CompletionSource,
	snippet,
} from '@codemirror/autocomplete';
import {
	commandIndex,
	environmentIndex,
	symbolIndex,
} from 'codemirror-lang-latex';
import type { EditorState, Text } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

import { t } from '@/i18n';
import { filePathCacheService } from '../../../services/FilePathCacheService';
import {
	findLatexDefinitions,
	type LatexDefinitions,
} from '../../../utils/latexDefinitions';
import { maskAnnotationText } from '../annotations/annotationMasking';

type Definitions = {
	commands: Map<string, { args: number; file: string }>;
	environments: Map<string, { args: number; file: string }>;
};

const fromDocs = new WeakMap<Text, LatexDefinitions>();

/** What this file defines and loads, as it is now (cached per document). */
export const definitionsHere = (state: EditorState): LatexDefinitions => {
	let found = fromDocs.get(state.doc);
	if (!found) {
		found = findLatexDefinitions(maskAnnotationText(state));
		fromDocs.set(state.doc, found);
	}
	return found;
};

const fileName = (path: string): string => path.split('/').pop() ?? path;

/** This file's definitions first (as typed), then the other files'. */
export function projectDefinitions(
	state: EditorState,
	currentFile: string,
	others: ReadonlyMap<string, LatexDefinitions>,
): Definitions {
	const found: Definitions = { commands: new Map(), environments: new Map() };
	const add = (definitions: LatexDefinitions, file: string) => {
		for (const { name, args } of definitions.commands) {
			if (commandIndex.has(name) || symbolIndex.has(name)) continue;
			if (!found.commands.has(name)) found.commands.set(name, { args, file });
		}
		for (const { name, args } of definitions.environments) {
			if (environmentIndex.has(name)) continue;
			if (!found.environments.has(name))
				found.environments.set(name, { args, file });
		}
	};
	add(definitionsHere(state), fileName(currentFile));
	for (const [path, definitions] of others) add(definitions, fileName(path));
	return found;
}

// A } right after the cursor (closed by the editor) is replaced, not doubled.
const withClosingBrace =
	(insert: ReturnType<typeof snippet>) =>
	(view: EditorView, completion: Completion, from: number, to: number) => {
		const end = view.state.sliceDoc(to, to + 1) === '}' ? to + 1 : to;
		insert(view, completion, from, end);
	};

const fields = (args: number) => '{${}}'.repeat(args);

export function commandCompletion(
	name: string,
	args: number,
	file: string,
): Completion {
	return {
		label: name,
		type: 'function',
		detail: t('defined in {file}', { file }),
		// A last field after the braces: Tab leaves the command.
		apply: args ? snippet(`${name}${fields(args)}\${}`) : name,
		boost: 2,
	};
}

export function environmentCompletion(
	name: string,
	args: number,
	file: string,
	opening: boolean,
): Completion {
	return {
		label: name,
		type: 'class',
		detail: t('defined in {file}', { file }),
		apply: withClosingBrace(
			snippet(
				opening
					? `${name}}${fields(args)}\n\t\${}\n\\end{${name}}`
					: `${name}}`,
			),
		),
		boost: 2,
	};
}

export function latexDefinitionsCompletion(
	currentFile: string,
): CompletionSource {
	return (context: CompletionContext): CompletionResult | null => {
		const environment = context.matchBefore(/\\(begin|end)\s*\{[a-zA-Z0-9*]*$/);
		if (environment) {
			const { environments } = projectDefinitions(
				context.state,
				currentFile,
				filePathCacheService.getTexDefinitions(),
			);
			if (environments.size === 0) return null;
			const opening = environment.text.startsWith('\\begin');
			return {
				from: environment.from + environment.text.indexOf('{') + 1,
				options: [...environments].map(([name, { args, file }]) =>
					environmentCompletion(name, args, file, opening),
				),
				validFor: /^[a-zA-Z0-9*]*$/,
			};
		}

		const command = context.matchBefore(/\\[a-zA-Z]*$/);
		if (!command) return null;
		const { commands } = projectDefinitions(
			context.state,
			currentFile,
			filePathCacheService.getTexDefinitions(),
		);
		if (commands.size === 0) return null;
		return {
			from: command.from,
			options: [...commands].map(([name, { args, file }]) =>
				commandCompletion(name, args, file),
			),
			validFor: /^\\[a-zA-Z]*$/,
		};
	};
}
