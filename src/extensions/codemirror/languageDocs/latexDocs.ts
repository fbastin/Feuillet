// src/extensions/codemirror/languageDocs/latexDocs.ts
// What a LaTeX command or environment does, shown on hover, in the user's
// language. The bundled tooltip of codemirror-lang-latex says it in English
// only; this one finds the same nodes, reads the same descriptions
// (latexDocsData) and keeps its class names, so that the styles still apply.
import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import { hoverTooltip, type Tooltip } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { commandIndex, environmentIndex } from 'codemirror-lang-latex';

import { t } from '@/i18n';
import {
	LATEX_COMMAND_DOCS,
	LATEX_ENVIRONMENT_DOCS,
	type LatexDoc,
} from './latexDocsData';

const ENVIRONMENT_NAME_NODES = new Set([
	'EnvName',
	'DocumentEnvName',
	'TabularEnvName',
	'EquationEnvName',
	'EquationArrayEnvName',
	'VerbatimEnvName',
	'TikzPictureEnvName',
	'FigureEnvName',
	'ListEnvName',
	'TableEnvName',
]);

export function commandDoc(name: string): LatexDoc | null {
	if (Object.hasOwn(LATEX_COMMAND_DOCS, name))
		return LATEX_COMMAND_DOCS[name]();
	const info = commandIndex.get(name);
	if (!info) return null;
	return {
		description: info.detail
			? t('Math symbol {symbol}', { symbol: info.detail })
			: info.math
				? t('Math-mode command.')
				: t('LaTeX command.'),
		syntax: info.template ?? info.name,
		package: info.package,
	};
}

export function environmentDoc(name: string): LatexDoc | null {
	if (Object.hasOwn(LATEX_ENVIRONMENT_DOCS, name)) {
		return LATEX_ENVIRONMENT_DOCS[name]();
	}
	const info = environmentIndex.get(name);
	if (!info) return null;
	return {
		description: info.math ? t('Math environment.') : t('LaTeX environment.'),
		syntax: `\\begin{${info.name}}...\\end{${info.name}}`,
		package: info.package,
	};
}

const environmentNameIn = (group: SyntaxNode): SyntaxNode | null => {
	for (let child = group.firstChild; child; child = child.nextSibling) {
		if (ENVIRONMENT_NAME_NODES.has(child.name)) return child;
	}
	return null;
};

/** The documented command or environment at `pos`, if any. */
export function latexDocAt(
	state: EditorState,
	pos: number,
): { from: number; to: number; doc: LatexDoc } | null {
	const node = syntaxTree(state).resolve(pos);
	const text = (from: number, to: number) => state.sliceDoc(from, to);

	if (
		node.name.endsWith('CtrlSeq') ||
		node.name === 'Begin' ||
		node.name === 'End'
	) {
		const doc = commandDoc(text(node.from, node.to));
		if (doc) return { from: node.from, to: node.to, doc };
	}
	if (node.name.endsWith('EnvName')) {
		const doc = environmentDoc(text(node.from, node.to));
		if (doc) return { from: node.from, to: node.to, doc };
	}
	if (node.parent?.name === 'EnvNameGroup') {
		const name = environmentNameIn(node.parent);
		const doc = name && environmentDoc(text(name.from, name.to));
		if (name && doc) return { from: name.from, to: name.to, doc };
	}
	return null;
}

const line = (className: string, text: string): HTMLElement => {
	const element = document.createElement('div');
	element.className = className;
	element.textContent = text;
	return element;
};

export function latexDocElement(doc: LatexDoc): HTMLElement {
	const content = document.createElement('div');
	content.className = 'cm-latex-tooltip';
	content.append(
		line('cm-latex-tooltip-description', doc.description),
		line('cm-latex-tooltip-syntax', `${t('Syntax:')} ${doc.syntax}`),
	);
	if (doc.example) {
		content.append(
			line('cm-latex-tooltip-example', `${t('Example:')} ${doc.example}`),
		);
	}
	if (doc.package) {
		content.append(
			line('cm-latex-tooltip-package', `${t('Package:')} ${doc.package}`),
		);
	}
	return content;
}

export const latexHoverDocs = hoverTooltip((view, pos): Tooltip | null => {
	const found = latexDocAt(view.state, pos);
	if (!found) return null;
	return {
		pos: found.from,
		end: found.to,
		above: true,
		create: () => ({ dom: latexDocElement(found.doc) }),
	};
});
