// src/services/AccountPreferencesService.ts
import { createNamedLogger } from '@/logging';
import {
	type PreferenceEntry,
	SYNCED_PROFILE_FIELDS,
	SYNCED_SETTINGS,
	type SyncedProfile,
	cleanPreferenceEntry,
	isSyncedSetting,
	preferenceTarget,
	preferencesToApply,
	profileKey,
	profileValueOf,
	settingKey,
} from '../utils/accountPreferences';
import {
	USER_DATA_CHANGED,
	type UserDataChangedDetail,
	getUserDataKey,
} from '../utils/userDataUtils';

const moduleLog = createNamedLogger('AccountPreferencesService');

// What this browser last knew of each preference of the account.
const ledgerKey = (userId: string) => `feuillet-account-preferences-${userId}`;
// SettingsContext takes, on this event, the settings changed elsewhere.
const SETTINGS_CHANGED_ELSEWHERE = 'chelys-account-store-changed';

export interface PreferencesProfileStore {
	profileOf(userId: string): Promise<SyncedProfile | null>;
	/** Applies profile fields set on another device. */
	applyProfile(userId: string, profile: SyncedProfile): Promise<void>;
}

const sameValue = (a: unknown, b: unknown): boolean =>
	JSON.stringify(a) === JSON.stringify(b);

// The preferences that follow the account (utils/accountPreferences): each
// change made here is kept with its time, for the account server, which
// keeps the latest of each and gives every device the same.
class AccountPreferencesService {
	private profiles: PreferencesProfileStore | null = null;
	private listeners = new Set<(userId: string) => void>();
	private listening = false;

	attachProfiles(profiles: PreferencesProfileStore): void {
		this.profiles = profiles;
		this.listen();
	}

	addListener(listener: (userId: string) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** The profile changed here: its fields that follow the account. */
	profileChanged(
		userId: string,
		before: SyncedProfile | null,
		after: SyncedProfile,
	): void {
		const changed = SYNCED_PROFILE_FIELDS.filter(
			(field) => (before?.[field] || null) !== (after[field] || null),
		);
		if (changed.length === 0) return;
		const ledger = this.read(userId);
		for (const field of changed) {
			const key = profileKey(field);
			ledger.set(key, {
				key,
				value: after[field] || null,
				updatedAt: Date.now(),
			});
		}
		this.changed(userId, ledger);
	}

	/**
	 * What to send the account server: every preference known here, those
	 * the account may not have yet at time 0, so that its own values win
	 * and the first device to sync gives its own.
	 */
	async entries(userId: string): Promise<PreferenceEntry[]> {
		const ledger = this.read(userId);
		let seeded = false;
		const settings = this.readSettings(userId);
		for (const id of SYNCED_SETTINGS) {
			const key = settingKey(id);
			if (ledger.has(key) || settings[id] === undefined) continue;
			ledger.set(key, { key, value: settings[id], updatedAt: 0 });
			seeded = true;
		}
		const profile = await this.profiles?.profileOf(userId).catch(() => null);
		for (const field of SYNCED_PROFILE_FIELDS) {
			const key = profileKey(field);
			if (ledger.has(key) || !profile?.[field]) continue;
			ledger.set(key, { key, value: profile[field], updatedAt: 0 });
			seeded = true;
		}
		if (seeded) this.write(userId, ledger);
		return [...ledger.values()];
	}

	/** Takes the account server's answer to what `sent` held. */
	async merge(
		userId: string,
		sent: PreferenceEntry[],
		answer: unknown[],
	): Promise<void> {
		const ledger = this.read(userId);
		const changes = preferencesToApply(
			ledger,
			new Map(sent.map((entry) => [entry.key, entry])),
			answer,
		);
		if (changes.length === 0) return;

		const settings: Record<string, unknown> = {};
		const profile: SyncedProfile = {};
		let profileChanged = false;
		for (const entry of changes) {
			const previous = ledger.get(entry.key);
			ledger.set(entry.key, entry);
			if (previous && sameValue(previous.value, entry.value)) continue;
			const target = preferenceTarget(entry.key);
			if (target?.kind === 'setting') {
				// Null too: the default of some, as the default keybindings.
				settings[target.id] = entry.value;
			} else if (target?.kind === 'profile') {
				profile[target.field] = profileValueOf(entry);
				profileChanged = true;
			}
		}
		this.write(userId, ledger);
		if (Object.keys(settings).length > 0) this.applySettings(userId, settings);
		if (profileChanged) await this.profiles?.applyProfile(userId, profile);
	}

	// The settings changed here, which SettingsContext announces.
	private listen(): void {
		if (this.listening || typeof window === 'undefined') return;
		this.listening = true;
		window.addEventListener(USER_DATA_CHANGED, (event) => {
			const detail = (event as CustomEvent<UserDataChangedDetail>).detail;
			const mutation = detail?.mutation;
			if (detail?.type !== 'settings' || !mutation || mutation.deleted) return;
			if (!isSyncedSetting(mutation.key) || mutation.value === undefined)
				return;
			const ledger = this.read(detail.userId);
			const key = settingKey(mutation.key);
			ledger.set(key, { key, value: mutation.value, updatedAt: Date.now() });
			this.changed(detail.userId, ledger);
		});
	}

	private changed(userId: string, ledger: Map<string, PreferenceEntry>): void {
		this.write(userId, ledger);
		for (const listener of this.listeners) listener(userId);
	}

	private applySettings(userId: string, values: Record<string, unknown>): void {
		const key = getUserDataKey(userId, 'settings');
		let stored: Record<string, unknown> = {};
		try {
			stored = JSON.parse(localStorage.getItem(key) ?? '{}') ?? {};
		} catch {
			stored = {};
		}
		localStorage.setItem(key, JSON.stringify({ ...stored, ...values }));
		window.dispatchEvent(
			new CustomEvent(SETTINGS_CHANGED_ELSEWHERE, {
				detail: { store: 'settings', userId },
			}),
		);
	}

	private readSettings(userId: string): Record<string, unknown> {
		try {
			const { _version, ...settings } = JSON.parse(
				localStorage.getItem(getUserDataKey(userId, 'settings')) ?? '{}',
			);
			return settings;
		} catch {
			return {};
		}
	}

	private read(userId: string): Map<string, PreferenceEntry> {
		const ledger = new Map<string, PreferenceEntry>();
		try {
			const stored = JSON.parse(
				localStorage.getItem(ledgerKey(userId)) ?? '[]',
			);
			for (const raw of Array.isArray(stored) ? stored : []) {
				const entry = cleanPreferenceEntry(raw);
				if (entry) ledger.set(entry.key, entry);
			}
		} catch (error) {
			moduleLog.warn('Could not read the account preferences:', error);
		}
		return ledger;
	}

	private write(userId: string, ledger: Map<string, PreferenceEntry>): void {
		localStorage.setItem(
			ledgerKey(userId),
			JSON.stringify([...ledger.values()]),
		);
	}
}

export const accountPreferencesService = new AccountPreferencesService();
