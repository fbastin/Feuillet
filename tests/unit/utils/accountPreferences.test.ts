import {
	cleanPreferenceEntry,
	isSyncedSetting,
	preferenceTarget,
	preferencesToApply,
	type PreferenceEntry,
} from '@src/utils/accountPreferences';

const map = (entries: PreferenceEntry[]) => new Map(entries.map((e) => [e.key, e]));

describe('account preferences', () => {
	it('follows the editor and the interface, not the servers nor the device', () => {
		for (const id of ['editor-font-size', 'editor-keymap-mode', 'theme-variant', 'language', 'editor-spelling-language', 'external-typesetter-auto-compile-on-open']) {
			expect(isSyncedSetting(id)).toBe(true);
		}
		for (const id of ['collab-websocket-server', 'texlive-server', 'theme-plugin', 'github-backup-api-endpoint', 'offline-force-app-offline', 'file-sys-backup-enable', 'latex-busytex-endpoint']) {
			expect(isSyncedSetting(id)).toBe(false);
		}
	});

	it('tells what a key names', () => {
		expect(preferenceTarget('setting:editor-font-size')).toEqual({ kind: 'setting', id: 'editor-font-size' });
		expect(preferenceTarget('profile:gitEmail')).toEqual({ kind: 'profile', field: 'gitEmail' });
		expect(preferenceTarget('profile:username')).toBeNull();
		expect(preferenceTarget('setting:texlive-server')).toBeNull();
		expect(preferenceTarget('editor-font-size')).toBeNull();
	});

	it('accepts only entries it can use', () => {
		expect(cleanPreferenceEntry({ key: 'setting:editor-font-size', value: 12, updatedAt: 3 })).toEqual({ key: 'setting:editor-font-size', value: 12, updatedAt: 3 });
		expect(cleanPreferenceEntry({ key: 'profile:gitEmail', updatedAt: 3 })).toEqual({ key: 'profile:gitEmail', value: null, updatedAt: 3 });
		expect(cleanPreferenceEntry({ key: 'setting:editor-font-size', value: 12 })).toBeNull();
		expect(cleanPreferenceEntry({ key: 'setting:collab-websocket-server', value: 'x', updatedAt: 1 })).toBeNull();
		expect(cleanPreferenceEntry('setting:editor-font-size')).toBeNull();
	});

	it("takes the server's answer, but for what changed here meanwhile", () => {
		const sent = map([
			{ key: 'setting:editor-font-size', value: 14, updatedAt: 0 },
			{ key: 'setting:theme-variant', value: 'dark', updatedAt: 5 },
			{ key: 'setting:editor-keymap-mode', value: 'vim', updatedAt: 5 },
		]);
		const local = map([
			{ key: 'setting:editor-font-size', value: 14, updatedAt: 0 },
			{ key: 'setting:theme-variant', value: 'dark', updatedAt: 5 },
			// Changed while the server answered.
			{ key: 'setting:editor-keymap-mode', value: 'emacs', updatedAt: 9 },
		]);
		const changes = preferencesToApply(local, sent, [
			{ key: 'setting:editor-font-size', value: 18, updatedAt: 0 },
			{ key: 'setting:theme-variant', value: 'dark', updatedAt: 5 },
			{ key: 'setting:editor-keymap-mode', value: 'vim', updatedAt: 5 },
			{ key: 'setting:editor-auto-indent', value: false, updatedAt: 2 },
			{ key: 'setting:texlive-server', value: 'wss://x', updatedAt: 2 },
			{ key: 'profile:gitEmail', value: 'me@example.org', updatedAt: 1 },
		]);
		expect(changes.map((e) => [e.key, e.value])).toEqual([
			['setting:editor-font-size', 18],
			['setting:editor-auto-indent', false],
			['profile:gitEmail', 'me@example.org'],
		]);
	});

	it('takes the time of a value it already has', () => {
		const entry = { key: 'setting:editor-font-size', value: 14, updatedAt: 0 };
		const changes = preferencesToApply(map([entry]), map([entry]), [{ ...entry, updatedAt: 0 }, { key: 'setting:theme-variant', value: 'light', updatedAt: 0 }]);
		expect(changes.map((e) => e.key)).toEqual(['setting:theme-variant']);
		const timed = preferencesToApply(map([entry]), map([entry]), [{ ...entry, updatedAt: 8 }]);
		expect(timed).toEqual([{ ...entry, updatedAt: 8 }]);
	});
});
