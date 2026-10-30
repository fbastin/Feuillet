// src/extensions/codemirror/undoSteps.ts
import { Facet } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

/**
 * Ways to start a new undo step outside CodeMirror's own history, such as
 * the Yjs undo manager of shared documents, which merges close changes.
 */
export const undoStepFacet = Facet.define<() => void>();

/** Makes what changes next an undo step of its own. */
export const separateUndoStep = (view: EditorView): void => {
	for (const start of view.state.facet(undoStepFacet)) start();
};
