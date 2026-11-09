// src/extensions/codemirror/languageDocs/bibtexDocs.ts
// What a BibTeX entry type or field is, shown on hover, in the user's
// language. The bundled tooltip of codemirror-lang-bib says it in English
// only; this one finds the same nodes, reads the same descriptions
// (bibtexDocsData) and keeps its class names, so that the styles still apply.
import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import { hoverTooltip, type Tooltip } from '@codemirror/view';

import { t } from '@/i18n';
import {
	BIBTEX_ENTRY_TYPE_DOCS,
	BIBTEX_FIELD_DOCS,
	type BibtexEntryTypeDoc,
	type BibtexFieldDoc,
} from './bibtexDocsData';

// Fields some reference managers add, which need no explanation.
const IGNORED_FIELDS = new Set(['remote-id', 'external-id']);

type BibtexDocAt =
	| { kind: 'type'; name: string; doc: BibtexEntryTypeDoc }
	| { kind: 'field'; name: string; doc: BibtexFieldDoc };

/** The documented entry type or field at `pos`, if any. */
export function bibtexDocAt(
	state: EditorState,
	pos: number,
	side: -1 | 1 = 1,
): (BibtexDocAt & { from: number; to: number }) | null {
	const node = syntaxTree(state).resolveInner(pos, side);
	const { from, to } = node;

	if (node.name === 'EntryType') {
		const name = state.sliceDoc(from + 1, to).toLowerCase();
		if (!Object.hasOwn(BIBTEX_ENTRY_TYPE_DOCS, name)) return null;
		return {
			kind: 'type',
			name,
			doc: BIBTEX_ENTRY_TYPE_DOCS[name](),
			from,
			to,
		};
	}
	if (node.name === 'FieldName') {
		const name = state.sliceDoc(from, to).toLowerCase();
		if (IGNORED_FIELDS.has(name) || !Object.hasOwn(BIBTEX_FIELD_DOCS, name)) {
			return null;
		}
		return { kind: 'field', name, doc: BIBTEX_FIELD_DOCS[name](), from, to };
	}
	return null;
}

const element = (tag: string, className: string, text: string): HTMLElement => {
	const node = document.createElement(tag);
	node.className = className;
	node.textContent = text;
	return node;
};

export function bibtexDocElement(found: BibtexDocAt): HTMLElement {
	const content = document.createElement('div');
	content.className = 'cm-bibtex-tooltip';

	if (found.kind === 'type') {
		const { doc } = found;
		content.append(
			element('div', 'cm-bibtex-tooltip-description', doc.description),
		);
		if (doc.requiredFields.length > 0) {
			content.append(
				element(
					'div',
					'cm-bibtex-tooltip-required',
					`${t('Required:')} ${doc.requiredFields.join(', ')}`,
				),
			);
		}
		if (doc.optionalFields.length > 0) {
			content.append(
				element(
					'div',
					'cm-bibtex-tooltip-optional',
					`${t('Optional:')} ${doc.optionalFields.join(', ')}`,
				),
			);
		}
		if (doc.example) {
			content.append(
				element('div', 'cm-bibtex-tooltip-example-label', t('Example:')),
				element('pre', 'cm-bibtex-tooltip-example', doc.example),
			);
		}
		return content;
	}

	const { doc } = found;
	content.append(
		element('div', 'cm-bibtex-tooltip-field-name', found.name),
		element('div', 'cm-bibtex-tooltip-description', doc.description),
	);
	if (doc.example) {
		content.append(
			element(
				'div',
				'cm-bibtex-tooltip-example',
				`${t('Example:')} ${doc.example}`,
			),
		);
	}
	if (doc.note) {
		content.append(
			element('div', 'cm-bibtex-tooltip-note', `${t('Note:')} ${doc.note}`),
		);
	}
	return content;
}

export const bibtexHoverDocs = hoverTooltip(
	(view, pos, side): Tooltip | null => {
		const found = bibtexDocAt(view.state, pos, side);
		if (!found) return null;
		return {
			pos: found.from,
			end: found.to,
			above: true,
			create: () => ({ dom: bibtexDocElement(found) }),
		};
	},
);
