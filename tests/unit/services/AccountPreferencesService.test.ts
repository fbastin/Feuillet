import { accountPreferencesService } from '@src/services/AccountPreferencesService';
import type { SyncedProfile } from '@src/utils/accountPreferences';
import { notifyUserDataChanged } from '@src/utils/userDataUtils';

const profiles: Record<string, SyncedProfile> = {};
const applied: Array<{ userId: string; profile: SyncedProfile }> = [];
accountPreferencesService.attachProfiles({
	profileOf: async (userId) => profiles[userId] ?? null,
	applyProfile: async (userId, profile) => {
		applied.push({ userId, profile });
	},
});

const settingsOf = (userId: string) =>
	JSON.parse(localStorage.getItem(`texlyre-user-${userId}-settings`) ?? '{}');
const ledgerOf = (userId: string) =>
	JSON.parse(localStorage.getItem(`feuillet-account-preferences-${userId}`) ?? '[]');

describe('AccountPreferencesService', () => {
	beforeEach(() => {
		localStorage.clear();
		applied.length = 0;
		for (const key of Object.keys(profiles)) delete profiles[key];
	});

	it('records the settings changed here that follow the account, with their time', () => {
		const changed = jest.fn();
		const stop = accountPreferencesService.addListener(changed);
		const before = Date.now();
		notifyUserDataChanged('u1', 'settings', { key: 'editor-font-size', value: 18 });
		notifyUserDataChanged('u1', 'settings', { key: 'collab-websocket-server', value: 'wss://elsewhere' });
		notifyUserDataChanged('u1', 'properties', { key: 'editor-font-size', value: 3 });
		stop();
		const ledger = ledgerOf('u1');
		expect(ledger).toHaveLength(1);
		expect(ledger[0]).toMatchObject({ key: 'setting:editor-font-size', value: 18 });
		expect(ledger[0].updatedAt).toBeGreaterThanOrEqual(before);
		expect(changed).toHaveBeenCalledTimes(1);
		expect(changed).toHaveBeenCalledWith('u1');
	});

	it('records the profile fields that changed', () => {
		accountPreferencesService.profileChanged(
			'u1',
			{ gitEmail: 'old@example.org', color: '#112233' },
			{ gitEmail: 'new@example.org', color: '#112233' },
		);
		accountPreferencesService.profileChanged('u1', { color: '#112233' }, { color: '#112233' });
		expect(ledgerOf('u1').map((e: { key: string; value: unknown }) => [e.key, e.value])).toEqual([
			['profile:gitEmail', 'new@example.org'],
		]);
		accountPreferencesService.profileChanged('u1', { gitEmail: 'new@example.org' }, {});
		expect(ledgerOf('u1')[0].value).toBeNull();
	});

	it('sends what the account may not have yet at time 0, so that its own values win', async () => {
		localStorage.setItem(
			'texlyre-user-u1-settings',
			JSON.stringify({ _version: '1.3.8', 'editor-font-size': 14, 'theme-variant': 'dark', 'collab-websocket-server': 'ws://x' }),
		);
		profiles.u1 = { gitEmail: 'me@example.org' };
		notifyUserDataChanged('u1', 'settings', { key: 'editor-keymap-mode', value: 'vim' });
		const sent = await accountPreferencesService.entries('u1');
		const byKey = Object.fromEntries(sent.map((e) => [e.key, e]));
		expect(Object.keys(byKey).sort()).toEqual([
			'profile:gitEmail',
			'setting:editor-font-size',
			'setting:editor-keymap-mode',
			'setting:theme-variant',
		]);
		expect(byKey['setting:editor-font-size'].updatedAt).toBe(0);
		expect(byKey['profile:gitEmail'].updatedAt).toBe(0);
		expect(byKey['setting:editor-keymap-mode'].updatedAt).toBeGreaterThan(0);
	});

	it('applies what the account holds: settings where SettingsContext reads them, then the profile', async () => {
		localStorage.setItem(
			'texlyre-user-u1-settings',
			JSON.stringify({ _version: '1.3.8', 'editor-font-size': 14, 'theme-variant': 'dark' }),
		);
		const heard = jest.fn();
		window.addEventListener('chelys-account-store-changed', heard);
		const sent = await accountPreferencesService.entries('u1');
		await accountPreferencesService.merge('u1', sent, [
			{ key: 'setting:editor-font-size', value: 20, updatedAt: 5 },
			{ key: 'setting:theme-variant', value: 'dark', updatedAt: 0 },
			{ key: 'setting:editor-keymap-mode', value: 'emacs', updatedAt: 7 },
			{ key: 'setting:collab-websocket-server', value: 'wss://evil', updatedAt: 9 },
			{ key: 'profile:gitEmail', value: 'other@example.org', updatedAt: 3 },
			{ key: 'profile:color', value: null, updatedAt: 3 },
		]);
		window.removeEventListener('chelys-account-store-changed', heard);
		expect(settingsOf('u1')).toEqual({
			_version: '1.3.8',
			'editor-font-size': 20,
			'theme-variant': 'dark',
			'editor-keymap-mode': 'emacs',
		});
		expect(heard).toHaveBeenCalledTimes(1);
		expect((heard.mock.calls[0][0] as CustomEvent).detail).toEqual({ store: 'settings', userId: 'u1' });
		expect(applied).toEqual([{ userId: 'u1', profile: { gitEmail: 'other@example.org', color: undefined } }]);
		// Known now: nothing more to apply.
		const again = await accountPreferencesService.entries('u1');
		applied.length = 0;
		await accountPreferencesService.merge('u1', again, again);
		expect(applied).toEqual([]);
	});

	it('leaves alone what changed here while the server answered', async () => {
		const sent = await accountPreferencesService.entries('u1');
		notifyUserDataChanged('u1', 'settings', { key: 'editor-font-size', value: 22 });
		await accountPreferencesService.merge('u1', sent, [
			{ key: 'setting:editor-font-size', value: 12, updatedAt: 1 },
		]);
		expect(settingsOf('u1')['editor-font-size']).toBeUndefined();
		expect(ledgerOf('u1')[0]).toMatchObject({ key: 'setting:editor-font-size', value: 22 });
	});

	it('sets a setting back to a null default, as the default keybindings', async () => {
		localStorage.setItem(
			'texlyre-user-u1-settings',
			JSON.stringify({ 'editor-keymap-mode': 'vim' }),
		);
		const sent = await accountPreferencesService.entries('u1');
		await accountPreferencesService.merge('u1', sent, [
			{ key: 'setting:editor-keymap-mode', value: null, updatedAt: 4 },
		]);
		expect(settingsOf('u1')['editor-keymap-mode']).toBeNull();
	});
});
