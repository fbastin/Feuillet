// src/utils/tagColors.ts
// The colors of the project tags, as Overleaf's: chosen by the account,
// kept as one setting that follows it to every device (accountPreferences).

/** The setting that holds them: { tag: '#rrggbb' }. */
export const TAG_COLORS_SETTING = 'project-tag-colors';

/** The nine offered, as Overleaf offers nine; any other may be chosen. */
export const PRESET_TAG_COLORS: readonly { value: string; name: string }[] = [
	{ value: '#d93f3f', name: 'Red' },
	{ value: '#e07b28', name: 'Orange' },
	{ value: '#d1a50f', name: 'Yellow' },
	{ value: '#3c9d4e', name: 'Green' },
	{ value: '#1f9c94', name: 'Teal' },
	{ value: '#3a7bd5', name: 'Blue' },
	{ value: '#7356d6', name: 'Purple' },
	{ value: '#c4479b', name: 'Pink' },
	{ value: '#7c8591', name: 'Gray' },
];

// The account keeps a preference of at most 4096 characters.
const MAX_CHARS = 4000;
const HEX = /^#[0-9a-f]{6}$/;

export type TagColors = Record<string, string>;

/** The colors of a stored value, those well formed only. */
export const cleanTagColors = (value: unknown): TagColors => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
	const colors: TagColors = {};
	for (const [tag, color] of Object.entries(value as Record<string, unknown>)) {
		if (!tag || tag.length > 100 || typeof color !== 'string') continue;
		const hex = color.toLowerCase();
		if (HEX.test(hex)) colors[tag] = hex;
	}
	return colors;
};

/**
 * `colors` with `tag` given `color`, or none; those of tags no project has
 * any more are let go, so that the setting stays small.
 */
export const withTagColor = (
	colors: TagColors,
	tag: string,
	color: string | null,
	tagsInUse: readonly string[],
): TagColors => {
	const inUse = new Set(tagsInUse);
	const next: TagColors = {};
	for (const [name, value] of Object.entries(colors)) {
		if (name !== tag && inUse.has(name)) next[name] = value;
	}
	const hex = color?.toLowerCase();
	if (hex && HEX.test(hex)) next[tag] = hex;
	// Over the account's limit, the earliest chosen go first.
	const entries = Object.entries(next);
	while (entries.length > 1 && JSON.stringify(entries).length > MAX_CHARS) {
		entries.shift();
	}
	return Object.fromEntries(entries);
};
