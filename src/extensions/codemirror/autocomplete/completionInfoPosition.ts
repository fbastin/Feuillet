// src/extensions/codemirror/autocomplete/completionInfoPosition.ts
// Where the description of the chosen completion goes: beside the list when
// it fits, as CodeMirror does; otherwise under the whole list (or above it),
// where CodeMirror would put it under the chosen line, over the next ones.
import { Direction, type EditorView, type Rect } from '@codemirror/view';

const INFO_WIDTH = 400;
const INFO_MARGIN = 30;

export function positionCompletionInfo(
	view: EditorView,
	list: Rect,
	option: Rect,
	info: Rect,
	space: Rect,
): { style?: string; class?: string } {
	const rtl = view.textDirection === Direction.RTL;
	const spaceLeft = list.left - space.left;
	const spaceRight = space.right - list.right;
	const infoWidth = info.right - info.left;
	const infoHeight = info.bottom - info.top;
	let left = rtl;
	if (left && spaceLeft < Math.min(infoWidth, spaceRight)) left = false;
	else if (!left && spaceRight < Math.min(infoWidth, spaceLeft)) left = true;

	if (infoWidth <= (left ? spaceLeft : spaceRight)) {
		const top =
			Math.max(space.top, Math.min(option.top, space.bottom - infoHeight)) -
			list.top;
		const maxWidth = Math.min(INFO_WIDTH, left ? spaceLeft : spaceRight);
		return {
			style: `top: ${top}px; max-width: ${maxWidth}px`,
			class: `cm-completionInfo-${left ? 'left' : 'right'}`,
		};
	}

	// No room beside: under the list, or above it if it fits better there.
	const maxWidth = Math.min(
		INFO_WIDTH,
		(rtl ? list.right : space.right - list.left) - INFO_MARGIN,
	);
	const height = list.bottom - list.top;
	const below = space.bottom - list.bottom;
	const above = list.top - space.top;
	const side = below >= infoHeight || below >= above ? 'top' : 'bottom';
	return {
		style: `${side}: ${height}px; max-width: ${maxWidth}px`,
		class: `cm-completionInfo-${rtl ? 'left' : 'right'}-narrow`,
	};
}
