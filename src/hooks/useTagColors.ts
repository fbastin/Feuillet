// src/hooks/useTagColors.ts
import { type CSSProperties, useCallback, useMemo } from 'react';

import { useSettings } from './useSettings';
import {
	TAG_COLORS_SETTING,
	type TagColors,
	cleanTagColors,
	withTagColor,
} from '../utils/tagColors';

/** The account's tag colors, and how to change one. */
export function useTagColors(): {
	colors: TagColors;
	setColor: (
		tag: string,
		color: string | null,
		tagsInUse: readonly string[],
	) => void;
} {
	const { getSetting, updateSetting } = useSettings();
	const stored = getSetting(TAG_COLORS_SETTING)?.value;
	const colors = useMemo(() => cleanTagColors(stored), [stored]);
	const setColor = useCallback(
		(tag: string, color: string | null, tagsInUse: readonly string[]) => {
			updateSetting(
				TAG_COLORS_SETTING,
				withTagColor(colors, tag, color, tagsInUse),
			);
		},
		[colors, updateSetting],
	);
	return { colors, setColor };
}

/** The style that gives a tag badge its color. */
export const tagStyle = (
	color: string | undefined,
): CSSProperties | undefined =>
	color ? ({ '--tag-color': color } as CSSProperties) : undefined;
