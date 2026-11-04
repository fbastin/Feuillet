// src/utils/accountPreferences.ts
// What follows the Feuillet account from one device to another, as Overleaf
// keeps its editor settings with the account: the preferences of the
// editor, the interface and compiling, and the profile's Git commit email
// and color. Never the servers' addresses, nor what belongs to a device
// (its theme layout, storage, offline mode, folders on its disk...).

/** The settings that follow the account. */
export const SYNCED_SETTINGS: readonly string[] = [
	// The interface.
	'language',
	'text-direction',
	'theme-variant',
	// The editor.
	'editor-font-family',
	'editor-font-size',
	'editor-show-line-numbers',
	'editor-text-direction',
	'editor-keymap-mode',
	'editor-auto-indent',
	'editor-theme-highlights',
	'editor-syntax-highlighting',
	'editor-spell-check',
	'editor-spelling-language',
	'editor-grammar-check',
	'editor-mathlive-enable',
	'editor-mathlive-preview-mode',
	'editor-auto-save-enable',
	'editor-auto-save-delay',
	// Compiling.
	'compilation-auto-expand-output',
	'external-typesetter-auto-compile-on-open',
	'external-typesetter-auto-navigate-to-main',
	'latex-auto-compile-on-open',
	'latex-auto-navigate-to-main',
	'latex-sourcemap-enable',
	'typst-auto-compile-on-open',
	'typst-auto-navigate-to-main',
	'typst-sourcemap-enable',
	'typst-default-format',
	// The PDF and the bibliography.
	'pdf-renderer-annotations',
	'pdf-renderer-text-selection',
	'bibtex-viewer-auto-tidy',
	'bibtex-viewer-tidy-options',
	'formatter-latex-notifications',
	'formatter-typst-notifications',
];

/** The profile's fields that follow the account. */
export const SYNCED_PROFILE_FIELDS = [
	'gitEmail',
	'color',
	'colorLight',
] as const;
export type SyncedProfileField = (typeof SYNCED_PROFILE_FIELDS)[number];
export type SyncedProfile = Partial<Record<SyncedProfileField, string>>;

/** A preference as a device last set it; null for none. */
export interface PreferenceEntry {
	key: string;
	value: unknown;
	updatedAt: number;
}

const SYNCED = new Set(SYNCED_SETTINGS);
const PROFILE_FIELDS = new Set<string>(SYNCED_PROFILE_FIELDS);

export const isSyncedSetting = (id: string): boolean => SYNCED.has(id);

export const settingKey = (id: string): string => `setting:${id}`;
export const profileKey = (field: SyncedProfileField): string =>
	`profile:${field}`;

/** What a key names: a synced setting, a synced profile field, or nothing. */
export const preferenceTarget = (
	key: string,
):
	| { kind: 'setting'; id: string }
	| { kind: 'profile'; field: SyncedProfileField }
	| null => {
	if (key.startsWith('setting:')) {
		const id = key.slice('setting:'.length);
		return SYNCED.has(id) ? { kind: 'setting', id } : null;
	}
	if (key.startsWith('profile:')) {
		const field = key.slice('profile:'.length);
		return PROFILE_FIELDS.has(field)
			? { kind: 'profile', field: field as SyncedProfileField }
			: null;
	}
	return null;
};

/** Accepts an entry of the account server or of this browser's copy. */
export const cleanPreferenceEntry = (raw: unknown): PreferenceEntry | null => {
	if (!raw || typeof raw !== 'object') return null;
	const { key, value, updatedAt } = raw as Record<string, unknown>;
	if (typeof key !== 'string' || !preferenceTarget(key)) return null;
	if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) return null;
	return { key, value: value === undefined ? null : value, updatedAt };
};

const sameValue = (a: unknown, b: unknown): boolean =>
	JSON.stringify(a) === JSON.stringify(b);

/**
 * What the account server's answer changes here. It merged what this device
 * sent, so it is right, but for what changed here while it answered: those
 * changes go with the next sync.
 */
export const preferencesToApply = (
	local: ReadonlyMap<string, PreferenceEntry>,
	sent: ReadonlyMap<string, PreferenceEntry>,
	answer: unknown[],
): PreferenceEntry[] => {
	const changes: PreferenceEntry[] = [];
	for (const raw of answer) {
		const entry = cleanPreferenceEntry(raw);
		if (!entry) continue;
		const current = local.get(entry.key);
		if (current && current.updatedAt !== sent.get(entry.key)?.updatedAt) {
			continue;
		}
		if (current && sameValue(current.value, entry.value)) {
			if (current.updatedAt !== entry.updatedAt) changes.push(entry);
			continue;
		}
		changes.push(entry);
	}
	return changes;
};

/** The value a profile field takes from an entry: none unless a string. */
export const profileValueOf = (entry: PreferenceEntry): string | undefined =>
	typeof entry.value === 'string' && entry.value ? entry.value : undefined;
