// src/extensions/codemirror/CollaboratorFlashExtension.ts
// The line a collaborator is on, lit for a moment in their color when one
// goes to them from their avatar, so that their cursor is easy to find.
import { type Extension, StateEffect, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';

import type { CollaboratorJump } from '../../services/CollaboratorJumpService';
import { collaboratorJumpService } from '../../services/CollaboratorJumpService';

const FLASH_MS = 1800;

const flashLine = StateEffect.define<{ pos: number; color: string } | null>();

const flashField = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(value, tr) {
		for (const effect of tr.effects) {
			if (!effect.is(flashLine)) continue;
			if (!effect.value) return Decoration.none;
			const line = tr.state.doc.lineAt(
				Math.min(effect.value.pos, tr.state.doc.length),
			);
			return Decoration.set([
				Decoration.line({
					class: 'cm-collaborator-flash',
					attributes: { style: `--collab-flash: ${effect.value.color}` },
				}).range(line.from),
			]);
		}
		return value.map(tr.changes);
	},
	provide: (field) => EditorView.decorations.from(field),
});

export const collaboratorFlashExtension: Extension = flashField;

/**
 * Shows a collaborator's cursor: the editor scrolls to it and lights its
 * line. Gives whether it was shown.
 */
export function showCollaborator(
	view: EditorView,
	jump: CollaboratorJump,
	pos: number,
	color: string,
): boolean {
	if (!view.state.field(flashField, false)) return false;
	const at = Math.max(0, Math.min(pos, view.state.doc.length));
	view.dispatch({
		effects: [
			EditorView.scrollIntoView(at, { y: 'center' }),
			flashLine.of({ pos: at, color }),
		],
	});
	collaboratorJumpService.done(jump);
	window.setTimeout(() => {
		if (view.dom.isConnected && view.state.field(flashField, false)) {
			view.dispatch({ effects: flashLine.of(null) });
		}
	}, FLASH_MS);
	return true;
}
