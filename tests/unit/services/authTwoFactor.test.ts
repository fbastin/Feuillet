// Signing in with two-factor authentication on a device that knows the
// account (src/services/AuthService.ts): the password is checked here, the
// code by the server. An account known to ask for a code waits for the
// server, never signing in offline; one not known yet may sign in offline
// when the server is slow, and is signed out should the server then ask for
// a code, which the next sign-in waits for.
import {
	AccountServerError,
	accountSyncService,
} from '@src/services/AccountSyncService';
import {
	TWO_FACTOR_SIGNED_OUT,
	TwoFactorRequiredError,
	authService,
	takeSignInNotice,
} from '@src/services/AuthService';
import type { User } from '@src/types/auth';

const PASSWORD = 'correct horse battery';
const session = (username: string) =>
	({ server: 'https://feuillet.example.org/collab', token: 't', username }) as never;

const deferred = <T>() => {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
};

const service = authService as unknown as {
	db: { put: (store: string, value: unknown) => Promise<unknown>; get: (store: string, key: string) => Promise<User | undefined> };
	hashPassword: (password: string) => Promise<string>;
	currentUser: User | null;
};

let count = 0;
const localUser = async (twoFactor?: boolean): Promise<User> => {
	await authService.initialize();
	count++;
	const user: User = {
		id: `user-${count}`,
		username: `ada${count}`,
		passwordHash: await service.hashPassword(PASSWORD),
		createdAt: Date.now(),
		...(twoFactor === undefined ? {} : { twoFactor }),
	};
	await service.db.put('users', user);
	return user;
};
const stored = (id: string) => service.db.get('users', id);
const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

describe('signing in with two-factor authentication', () => {
	beforeEach(() => {
		jest.restoreAllMocks();
		jest.spyOn(accountSyncService, 'start').mockImplementation(() => {});
		jest.spyOn(accountSyncService, 'signOut').mockResolvedValue();
		jest.spyOn(accountSyncService, 'getSession').mockReturnValue(null);
		jest.spyOn(accountSyncService, 'saveSession').mockImplementation(() => {});
		jest.spyOn(accountSyncService, 'twoFactorStatus').mockResolvedValue(null);
		sessionStorage.clear();
	});

	it('asks for the code, and remembers that the account does', async () => {
		const user = await localUser();
		jest
			.spyOn(accountSyncService, 'login')
			.mockRejectedValue(new AccountServerError('code_required', 401));
		await expect(authService.login(user.username, PASSWORD)).rejects.toBeInstanceOf(
			TwoFactorRequiredError,
		);
		expect((await stored(user.id))?.twoFactor).toBe(true);
	});

	it('waits for the server, however slow, for an account known to ask for a code', async () => {
		const user = await localUser(true);
		const answer = deferred<never>();
		jest.spyOn(accountSyncService, 'login').mockReturnValue(answer.promise);
		let outcome: string | null = null;
		const signingIn = authService
			.login(user.username, PASSWORD)
			.then(() => 'signed-in')
			.catch((error) => (error instanceof TwoFactorRequiredError ? 'code' : 'error'))
			.then((result) => {
				outcome = result;
			});
		// Past the 4 s after which an account not known so signs in offline.
		await settle(4300);
		expect(outcome).toBeNull();
		answer.reject(new AccountServerError('code_required', 401));
		await signingIn;
		expect(outcome).toBe('code');
	}, 10_000);

	it('signs in with the code, keeping it known', async () => {
		const user = await localUser(true);
		const login = jest
			.spyOn(accountSyncService, 'login')
			.mockResolvedValue(session(user.username));
		const signedIn = await authService.login(user.username, PASSWORD, '123456');
		expect(login).toHaveBeenCalledWith(expect.any(String), user.username, PASSWORD, '123456');
		expect(signedIn.twoFactor).toBe(true);
		expect((await stored(user.id))?.twoFactor).toBe(true);
		await authService.logout();
	});

	it('does not sign in offline an account known to ask for a code', async () => {
		const user = await localUser(true);
		jest
			.spyOn(accountSyncService, 'login')
			.mockRejectedValue(new AccountServerError('unreachable'));
		await expect(authService.login(user.username, PASSWORD)).rejects.toThrow(
			/needs the server/,
		);
		expect(service.currentUser).toBeNull();
	});

	it('signs an account not known yet out, should a slow server then ask for a code', async () => {
		const user = await localUser();
		const answer = deferred<never>();
		jest.spyOn(accountSyncService, 'login').mockReturnValue(answer.promise);
		const signedOut = jest.fn();
		window.addEventListener(TWO_FACTOR_SIGNED_OUT, signedOut);
		// Offline, after 4 s.
		const signedIn = await authService.login(user.username, PASSWORD);
		expect(signedIn.id).toBe(user.id);
		expect(authService.getCurrentUser()?.id).toBe(user.id);
		answer.reject(new AccountServerError('code_required', 401));
		await settle(50);
		expect(signedOut).toHaveBeenCalledTimes(1);
		expect(authService.getCurrentUser()).toBeNull();
		expect((await stored(user.id))?.twoFactor).toBe(true);
		expect(takeSignInNotice()).toMatch(/Two-factor authentication is on/);
		// Said once.
		expect(takeSignInNotice()).toBeNull();
		window.removeEventListener(TWO_FACTOR_SIGNED_OUT, signedOut);
	}, 10_000);

	it('keeps what it knows when the profile saves an older copy of the user', async () => {
		const user = await localUser(true);
		const { twoFactor: _known, ...older } = user;
		await authService.updateUser({ ...older, color: '#2f8a52' });
		expect(await stored(user.id)).toEqual(
			expect.objectContaining({ color: '#2f8a52', twoFactor: true }),
		);
	});
});
