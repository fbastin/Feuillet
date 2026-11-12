// src/services/AuthService.ts
import { type IDBPDatabase, openDB } from 'idb';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';

import { t } from '@/i18n';
import { createNamedLogger } from '@/logging';
import type { User } from '../types/auth';
import type {
	Project,
	ProjectCreateInput,
	ProjectGroup,
	ProjectType,
} from '../types/projects';
import { accountFieldsChanged } from '../utils/accountSyncUtils';
import { generateRandomColor } from '../utils/colorUtils';
import { cleanupProjectDatabases } from '../utils/dbDeleteUtils';
import {
	SYNCED_PROFILE_FIELDS,
	type SyncedProfile,
} from '../utils/accountPreferences';
import { generateYjsProjectId, signUpAdmissionOf } from '../utils/urlUtils';
import { getUserDataKey } from '../utils/userDataUtils';
import {
	type AccountSession,
	AccountServerError,
	accountSyncService,
} from './AccountSyncService';
import { accountPreferencesService } from './AccountPreferencesService';
import { diskBackupService } from './DiskBackupService';
import {
	PROVIDER_NAMES,
	type ProviderTicket,
	type SignInProvider,
} from './ExternalSignInService';
import { personalDictionaryService } from './PersonalDictionaryService';

const moduleLog = createNamedLogger('AuthService');

// How long signing in waits for the server's session, on a device that
// knows the account, before going on without it.
const LINK_WAIT_MS = 4000;

/** The server asks for the code of two-factor authentication. */
export class TwoFactorRequiredError extends Error {
	constructor() {
		super(t('Enter the code that your authenticator app shows.'));
		this.name = 'TwoFactorRequiredError';
	}
}

const wrongCodeMessage = () =>
	t(
		'This code is not right, or was already used. Enter the one your app shows now.',
	);

const COMMIT_EMAILS_KEPT = 'feuillet-commit-emails-kept';
/** The profile changed on another device of the account: detail, the user. */
export const USER_PROFILE_SYNCED = 'feuillet-user-profile-synced';

const shouldAutoSync = (): boolean => {
	return localStorage.getItem('texlyre-auto-sync') === 'true';
};

class AuthService {
	public db: IDBPDatabase | null = null;
	private readonly DB_NAME = 'texlyre-auth';
	private readonly USER_STORE = 'users';
	private readonly PROJECT_STORE = 'projects';
	private readonly DB_VERSION = 1;
	private currentUser: User | null = null;

	async initialize(): Promise<void> {
		try {
			this.db = await openDB(this.DB_NAME, this.DB_VERSION, {
				upgrade: (db, _oldVersion, _newVersion) => {
					if (!db.objectStoreNames.contains(this.USER_STORE)) {
						const userStore = db.createObjectStore(this.USER_STORE, {
							keyPath: 'id',
						});
						userStore.createIndex('username', 'username', { unique: false });
						userStore.createIndex('email', 'email', { unique: false });
						userStore.createIndex('sessionId', 'sessionId', { unique: false });
					}

					if (!db.objectStoreNames.contains(this.PROJECT_STORE)) {
						const projectStore = db.createObjectStore(this.PROJECT_STORE, {
							keyPath: 'id',
						});
						projectStore.createIndex('ownerId', 'ownerId', { unique: false });
						projectStore.createIndex('tags', 'tags', {
							unique: false,
							multiEntry: true,
						});
					}
				},
			});

			await this.keepCommitEmails();

			const userId = localStorage.getItem('texlyre-current-user');
			if (userId) {
				try {
					const user = await this.getUserById(userId);
					if (user) {
						if (this.isGuestUser(user) && this.isGuestExpired(user)) {
							moduleLog.info(`Guest session expired: ${userId}`);
							await this.cleanupExpiredGuest(user);
							localStorage.removeItem('texlyre-current-user');
						} else {
							this.currentUser = user;
							moduleLog.info(
								`Restored user session: ${user.username} (${this.isGuestUser(user) ? 'guest' : 'full'})`,
							);
							if (!this.isGuestUser(user)) accountSyncService.start(user.id);
						}
					} else {
						moduleLog.info(`User not found: ${userId}`);
						localStorage.removeItem('texlyre-current-user');
					}
				} catch (error) {
					moduleLog.error('Error restoring user session:', error);
					localStorage.removeItem('texlyre-current-user');
				}
			}

			// Run cleanup on initialization
			this.cleanupExpiredGuests();
		} catch (error) {
			moduleLog.error('Failed to initialize database:', error);
			throw error;
		}
	}

	private async getDatabase(): Promise<IDBPDatabase> {
		if (!this.db) await this.initialize();
		if (!this.db) throw new Error(t('Database not initialized'));
		return this.db;
	}

	async hashPassword(password: string): Promise<string> {
		const msgBuffer = new TextEncoder().encode(password);
		const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
	}

	generateSessionId(): string {
		return `guest_${Math.random().toString(36).substring(2, 15)}_${Date.now()}`;
	}

	isGuestUser(user: User | null): boolean {
		return !!user?.isGuest;
	}

	isGuestExpired(user: User | null): boolean {
		if (!user || !this.isGuestUser(user) || !user.expiresAt) return false;
		return Date.now() > user.expiresAt;
	}

	async createGuestAccount(): Promise<User> {
		if (!this.db) {
			moduleLog.info('Database not initialized, initializing...');
			await this.initialize();
		}

		await this.cleanupExpiredGuests();

		const sessionId = this.generateSessionId();
		const userId = `guest_${crypto.randomUUID()}`;
		const now = Date.now();
		const expiresAt = now + 24 * 60 * 60 * 1000;

		const guestUser: User = {
			id: userId,
			username: t('Guest User'),
			passwordHash: await this.hashPassword(sessionId),
			isGuest: true,
			sessionId,
			expiresAt,
			createdAt: now,
			lastLogin: now,
			color: generateRandomColor(false),
			colorLight: generateRandomColor(true),
		};

		try {
			moduleLog.info(`Creating guest user with ID: ${userId}`);
			await this.db?.put(this.USER_STORE, guestUser);

			const verifyUser = await this.db?.get(this.USER_STORE, userId);
			if (!verifyUser) {
				throw new Error(t('Failed to verify guest user creation'));
			}

			this.currentUser = guestUser;
			localStorage.setItem('texlyre-current-user', userId);

			moduleLog.info(`Successfully created guest account: ${sessionId}`);
			return guestUser;
		} catch (error) {
			moduleLog.error('Failed to create guest account:', error);
			throw new Error(
				t(
					'Failed to create guest session. Please refresh the page and try again',
				),
			);
		}
	}

	async upgradeGuestAccount(
		username: string,
		password: string,
		email?: string,
	): Promise<User> {
		if (!this.db) await this.initialize();
		if (!this.currentUser || !this.isGuestUser(this.currentUser)) {
			throw new Error(t('No guest account to upgrade'));
		}

		const existingUser = await this.db?.getFromIndex(
			this.USER_STORE,
			'username',
			username,
		);
		if (existingUser && !this.isGuestUser(existingUser)) {
			throw new Error(t('Username already exists'));
		}

		if (email) {
			const existingEmail = await this.db?.getFromIndex(
				this.USER_STORE,
				'email',
				email,
			);
			if (existingEmail && !this.isGuestUser(existingEmail)) {
				throw new Error(t('Email already exists'));
			}
		}

		const session = await this.registerOnServer(username, password);
		const passwordHash = await this.hashPassword(password);
		const now = Date.now();
		const oldGuestId = this.currentUser.id;
		const newUserId = crypto.randomUUID();

		const upgradedUser: User = {
			id: newUserId,
			username,
			email,
			passwordHash,
			createdAt: this.currentUser.createdAt,
			lastLogin: now,
			color: this.currentUser.color,
			colorLight: this.currentUser.colorLight,
			isGuest: undefined,
			sessionId: undefined,
			expiresAt: undefined,
		};

		// This transfers ownership of all guest projects to the new user
		await this.transferGuestProjects(oldGuestId, newUserId);
		await this.db?.put(this.USER_STORE, upgradedUser);
		await this.db?.delete(this.USER_STORE, oldGuestId);

		this.currentUser = upgradedUser;
		this.transferUserSettings(oldGuestId, newUserId);
		personalDictionaryService.transfer(oldGuestId, newUserId);
		localStorage.setItem('texlyre-current-user', newUserId);
		if (session) accountSyncService.saveSession(newUserId, session);
		accountSyncService.start(newUserId);

		moduleLog.info(
			`Upgraded guest account ${oldGuestId} to full account: ${username} (${newUserId})`,
		);
		return upgradedUser;
	}

	private transferUserSettings(fromUserId: string, toUserId: string): void {
		for (const store of ['settings', 'properties'] as const) {
			const raw = localStorage.getItem(getUserDataKey(fromUserId, store));
			if (raw === null) continue;
			localStorage.setItem(getUserDataKey(toUserId, store), raw);
			localStorage.removeItem(getUserDataKey(fromUserId, store));
		}
	}

	private async transferGuestProjects(
		oldUserId: string,
		newUserId: string,
	): Promise<void> {
		if (!this.db) return;

		try {
			const guestProjects = await this.getProjectsByUser(oldUserId);

			for (const project of guestProjects) {
				const updatedProject = {
					...project,
					ownerId: newUserId,
					updatedAt: Date.now(),
				};
				await this.db.put(this.PROJECT_STORE, updatedProject);
			}

			moduleLog.info(
				`Transferred ${guestProjects.length} projects from guest ${oldUserId} to user ${newUserId}`,
			);
		} catch (error) {
			moduleLog.error('Error transferring guest projects:', error);
		}
	}

	async cleanupExpiredGuests(): Promise<void> {
		if (!this.db) return;

		try {
			const tx = this.db.transaction(
				[this.USER_STORE, this.PROJECT_STORE],
				'readwrite',
			);
			const userStore = tx.objectStore('users');

			const allUsers = await userStore.getAll();
			const expiredGuests = allUsers.filter(
				(user) => this.isGuestUser(user) && this.isGuestExpired(user),
			);

			for (const expiredGuest of expiredGuests) {
				await this.cleanupExpiredGuest(expiredGuest);
			}

			moduleLog.info(
				`Cleaned up ${expiredGuests.length} expired guest accounts`,
			);
		} catch (error) {
			moduleLog.error('Error during guest cleanup:', error);
		}
	}

	async cleanupExpiredGuest(guestUser: User): Promise<void> {
		if (!this.db) return;

		try {
			moduleLog.info(`Cleaning up guest: ${guestUser.id}`);

			const guestProjects = await this.getProjectsByUser(guestUser.id);
			moduleLog.info(`Found ${guestProjects.length} guest projects to cleanup`);

			for (const project of guestProjects) {
				try {
					await cleanupProjectDatabases(project);
				} catch (error) {
					moduleLog.warn(
						`Failed to cleanup project database for ${project.id}:`,
						error,
					);
				}
			}

			if (guestProjects.length > 0) {
				const projectTx = this.db.transaction(this.PROJECT_STORE, 'readwrite');
				for (const project of guestProjects) {
					try {
						await projectTx.objectStore('projects').delete(project.id);
					} catch (error) {
						moduleLog.warn(`Failed to delete project ${project.id}:`, error);
					}
				}
			}

			const userTx = this.db.transaction(this.USER_STORE, 'readwrite');
			await userTx.objectStore('users').delete(guestUser.id);

			moduleLog.info(`Successfully cleaned up guest: ${guestUser.id}`);
		} catch (error) {
			moduleLog.error(`Error cleaning up guest ${guestUser.id}:`, error);
		}
	}

	// A profile's email used to be its Git commits' author too; it is now the
	// account's address, which recovers it, so the commits keep their own
	// copy of it (once per browser).
	private async keepCommitEmails(): Promise<void> {
		if (localStorage.getItem(COMMIT_EMAILS_KEPT)) return;
		const users = ((await this.db?.getAll(this.USER_STORE)) ?? []) as User[];
		for (const user of users) {
			if (user.email && user.gitEmail === undefined) {
				await this.db?.put(this.USER_STORE, { ...user, gitEmail: user.email });
			}
		}
		localStorage.setItem(COMMIT_EMAILS_KEPT, '1');
	}

	async register(
		username: string,
		password: string,
		email?: string,
		// Google's or ORCID's sign-in, to link the account to that account.
		link?: ProviderTicket,
	): Promise<User> {
		if (!this.db) await this.initialize();

		const existingUser = await this.db?.getFromIndex(
			this.USER_STORE,
			'username',
			username,
		);
		if (existingUser && !this.isGuestUser(existingUser)) {
			throw new Error(t('Username already exists'));
		}

		if (email) {
			const existingEmail = await this.db?.getFromIndex(
				this.USER_STORE,
				'email',
				email,
			);
			if (existingEmail && !this.isGuestUser(existingEmail)) {
				throw new Error(t('Email already exists'));
			}
		}

		const session = await this.registerOnServer(username, password, link);
		const passwordHash = await this.hashPassword(password);
		const userId = crypto.randomUUID();
		const now = Date.now();

		const newUser: User = {
			id: userId,
			username,
			passwordHash,
			email,
			createdAt: now,
			lastLogin: now,
		};

		await this.db?.put(this.USER_STORE, newUser);
		this.currentUser = newUser;
		localStorage.setItem('texlyre-current-user', userId);
		if (session) accountSyncService.saveSession(userId, session);
		accountSyncService.start(userId);

		return newUser;
	}

	/**
	 * Signs in; with two-factor authentication on, `code` is the code of the
	 * authenticator app or a recovery code. Throws TwoFactorRequiredError
	 * when the server asks for one: the form then asks, and signs in again.
	 */
	async login(
		username: string,
		password: string,
		code?: string,
	): Promise<User> {
		if (!this.db) await this.initialize();

		const found = await this.db?.getFromIndex(
			this.USER_STORE,
			'username',
			username,
		);
		let user: User | undefined =
			found && !this.isGuestUser(found) ? found : undefined;
		const passwordHash = await this.hashPassword(password);

		if (user && user.passwordHash === passwordHash) {
			// The server's session, when this device has none any more: with
			// two-factor authentication, it takes the code. A server slow to
			// answer does not hold up the sign-in, which goes on offline.
			const linking = this.linkAccount(user, password, code);
			const early = await Promise.race([
				linking,
				new Promise<'pending'>((resolve) =>
					setTimeout(() => resolve('pending'), LINK_WAIT_MS),
				),
			]);
			if (early === 'code_required') throw new TwoFactorRequiredError();
			if (early === 'wrong_code') throw new Error(wrongCodeMessage());
		} else {
			// Unknown here, or another password: the account may have been
			// created, or its password changed, on another device.
			const session = await this.signInOnServer(
				user?.username ?? username,
				password,
				code,
			);
			if (!session) {
				throw new Error(user ? t('Invalid password') : t('User not found'));
			}

			user ??= (await this.getUserByUsername(session.username)) ?? undefined;
			// A local account that was never linked to this server account
			// keeps its own password, even if someone took its name there.
			if (user && !accountSyncService.wasLinkedTo(user.id, session.username)) {
				void accountSyncService.endSession(session);
				throw new Error(t('Invalid password'));
			}
			user = user
				? { ...user, passwordHash }
				: {
						id: crypto.randomUUID(),
						username: session.username,
						passwordHash,
						createdAt: Date.now(),
					};
			accountSyncService.saveSession(user.id, session);
		}

		user.lastLogin = Date.now();
		await this.db?.put(this.USER_STORE, user);

		this.currentUser = user;
		localStorage.setItem('texlyre-current-user', user.id);
		accountSyncService.start(user.id);

		return user;
	}

	// Creates the account on the server too, so that it can be opened on other
	// devices. Without the server (offline, or none configured), the account
	// stays in this browser and is linked at a later sign-in; but not one to
	// be linked to a Google or ORCID account, which only the server can do.
	private async registerOnServer(
		username: string,
		password: string,
		link?: ProviderTicket,
	): Promise<AccountSession | null> {
		try {
			return await accountSyncService.register(
				accountSyncService.serverFor(),
				username,
				password,
				link,
				signUpAdmissionOf(window.location.hash),
			);
		} catch (error) {
			if (error instanceof AccountServerError) {
				// The server makes accounts only with an invitation.
				if (error.code === 'sign_up_closed') {
					throw new Error(
						t(
							'Accounts on this server are made by invitation: ask a member to invite you to a project, or an administrator for a link to create an account.',
						),
					);
				}
				if (error.code === 'sign_up_link_expired') {
					throw new Error(
						t(
							'This link to create an account was already used, or has expired. Ask for another one.',
						),
					);
				}
				if (error.code === 'username_taken') {
					throw new Error(
						t(
							'This username already has an account on the server. Log in with its password instead.',
						),
					);
				}
				if (error.code === 'too_many_attempts') {
					throw new Error(
						t('Too many attempts. Please try again in a few minutes.'),
					);
				}
				const provider = link ? PROVIDER_NAMES[link.provider] : '';
				if (link && error.code === `${link.provider}_taken`) {
					throw new Error(
						t(
							'This {provider} account is already linked to another Feuillet account: sign in with {provider} instead.',
							{ provider },
						),
					);
				}
				if (link && error.code === 'invalid_ticket') {
					throw new Error(
						t(
							'The confirmation from {provider} expired. Sign in with {provider} again.',
							{ provider },
						),
					);
				}
			}
			if (link) {
				throw new Error(
					t('The server could not be reached. Please try again later.'),
				);
			}
			moduleLog.warn('Account not created on the server:', error);
			return null;
		}
	}

	/**
	 * Signs in with a Google or ORCID account, to the account linked to it,
	 * as on Overleaf: 'not-linked' when it is linked to none, so that one may
	 * be created. A browser that has not seen the account yet does not know
	 * its password; the server checks it when it is asked for
	 * (verifyPassword).
	 */
	async loginWithProvider(
		provider: SignInProvider,
		ticket: string,
		secondFactor?: string,
	): Promise<User | 'not-linked'> {
		if (!this.db) await this.initialize();

		let session: AccountSession;
		try {
			session = await accountSyncService.loginWithProvider(
				accountSyncService.serverFor(),
				provider,
				ticket,
				secondFactor,
			);
		} catch (error) {
			const code = error instanceof AccountServerError ? error.code : '';
			if (code === `${provider}_not_linked`) return 'not-linked';
			if (code === 'code_required') throw new TwoFactorRequiredError();
			if (code === 'wrong_code') throw new Error(wrongCodeMessage());
			if (code === 'too_many_attempts') {
				throw new Error(
					t('Too many attempts. Please try again in a few minutes.'),
				);
			}
			if (code === 'invalid_ticket') {
				throw new Error(
					t(
						'The confirmation from {provider} expired. Sign in with {provider} again.',
						{ provider: PROVIDER_NAMES[provider] },
					),
				);
			}
			throw new Error(
				t('The server could not be reached. Please try again later.'),
			);
		}

		const found = await this.getUserByUsername(session.username);
		let user: User | undefined =
			found && !this.isGuestUser(found) ? found : undefined;
		// An account of this browser by that name, never linked to the
		// server's, is someone else's: it keeps its own password.
		if (user && !accountSyncService.wasLinkedTo(user.id, session.username)) {
			void accountSyncService.endSession(session);
			throw new Error(
				t(
					'This browser has another account named {username}: sign in with its password.',
					{ username: session.username },
				),
			);
		}
		user ??= {
			id: crypto.randomUUID(),
			username: session.username,
			passwordHash: '',
			createdAt: Date.now(),
		};
		accountSyncService.saveSession(user.id, session);
		user.lastLogin = Date.now();
		await this.db?.put(this.USER_STORE, user);

		this.currentUser = user;
		localStorage.setItem('texlyre-current-user', user.id);
		accountSyncService.start(user.id);
		return user;
	}

	private async signInOnServer(
		username: string,
		password: string,
		code?: string,
	): Promise<AccountSession | null> {
		try {
			return await accountSyncService.login(
				accountSyncService.serverFor(),
				username,
				password,
				code,
			);
		} catch (error) {
			if (error instanceof AccountServerError) {
				if (error.code === 'wrong_password') {
					throw new Error(t('Invalid password'));
				}
				if (error.code === 'code_required') throw new TwoFactorRequiredError();
				if (error.code === 'wrong_code') throw new Error(wrongCodeMessage());
				if (error.code === 'too_many_attempts') {
					throw new Error(
						t('Too many attempts. Please try again in a few minutes.'),
					);
				}
			}
			return null;
		}
	}

	// Links an account of this browser to the same account on the server,
	// creating it there if its name is free.
	async linkAccount(
		user: User,
		password: string,
		code?: string,
	): Promise<
		'linked' | 'taken' | 'unreachable' | 'code_required' | 'wrong_code'
	> {
		if (this.isGuestUser(user)) return 'unreachable';
		if (accountSyncService.getSession(user.id)) return 'linked';

		const server = accountSyncService.serverFor(user.id);
		let session: AccountSession;
		try {
			session = await accountSyncService.login(
				server,
				user.username,
				password,
				code,
			);
		} catch (error) {
			if (
				error instanceof AccountServerError &&
				(error.code === 'code_required' || error.code === 'wrong_code')
			) {
				return error.code;
			}
			if (
				!(error instanceof AccountServerError) ||
				error.code !== 'unknown_username'
			) {
				return error instanceof AccountServerError &&
					error.code === 'wrong_password'
					? 'taken'
					: 'unreachable';
			}
			try {
				session = await accountSyncService.register(
					server,
					user.username,
					password,
				);
			} catch (registerError) {
				return registerError instanceof AccountServerError &&
					registerError.code === 'username_taken'
					? 'taken'
					: 'unreachable';
			}
		}

		accountSyncService.saveSession(user.id, session);
		if (this.currentUser?.id === user.id) accountSyncService.start(user.id);
		moduleLog.info(`Linked ${user.username} to the server account`);
		return 'linked';
	}

	async logout(): Promise<void> {
		const user = this.currentUser;
		this.currentUser = null;
		localStorage.removeItem('texlyre-current-user');

		if (!user) return;

		void accountSyncService.signOut(user.id);

		if (this.isGuestUser(user)) {
			try {
				await this.db?.put(this.USER_STORE, {
					...user,
					expiresAt: Date.now() - 1,
				});
			} catch (error) {
				moduleLog.warn('Failed to mark guest session for cleanup:', error);
			}
		}

		try {
			const { chelysService } = await import('./ChelysService');
			chelysService.logoutChelys(user.id);
		} catch (error) {
			moduleLog.warn('Failed to clear Chelys session:', error);
		}
	}

	async updateUser(user: User): Promise<User> {
		if (!this.db) await this.initialize();
		const before: User | undefined = await this.db?.get(
			this.USER_STORE,
			user.id,
		);
		await this.db?.put(this.USER_STORE, user);

		if (this.currentUser && this.currentUser.id === user.id) {
			this.currentUser = user;
		}
		// The Git commit email and the color follow the account.
		if (before) accountPreferencesService.profileChanged(user.id, before, user);

		return user;
	}

	/** Profile fields set on another device of the account. */
	async applySyncedProfile(
		userId: string,
		profile: SyncedProfile,
	): Promise<void> {
		const user = await this.getUserById(userId);
		if (!user) return;
		const updated: User = { ...user };
		for (const field of SYNCED_PROFILE_FIELDS) {
			if (field in profile) updated[field] = profile[field];
		}
		await this.db?.put(this.USER_STORE, updated);
		if (this.currentUser?.id === userId) this.currentUser = updated;
		window.dispatchEvent(
			new CustomEvent<User>(USER_PROFILE_SYNCED, { detail: updated }),
		);
	}

	async updateUserColor(
		userId: string,
		color?: string,
		colorLight?: string,
	): Promise<User> {
		if (!this.db) await this.initialize();

		const user = await this.getUserById(userId);
		if (!user) {
			throw new Error(t('User not found'));
		}

		const updatedUser: User = {
			...user,
			color,
			colorLight,
		};

		await this.updateUser(updatedUser);
		return updatedUser;
	}

	async getUserById(id: string): Promise<User | null> {
		if (!this.db) await this.initialize();
		return this.db?.get(this.USER_STORE, id);
	}

	async getUserByUsername(username: string): Promise<User | null> {
		if (!this.db) await this.initialize();
		const user = await this.db?.getFromIndex(
			this.USER_STORE,
			'username',
			username,
		);
		return user && !this.isGuestUser(user) ? user : null;
	}

	async setCurrentUser(userId: string): Promise<User | null> {
		const user = await this.getUserById(userId);
		if (user) {
			this.currentUser = user;
			localStorage.setItem('texlyre-current-user', userId);
		}
		return user;
	}

	getCurrentUser(): User | null {
		return this.currentUser;
	}

	isAuthenticated(): boolean {
		return !!this.currentUser;
	}

	async verifyPassword(userId: string, password: string): Promise<boolean> {
		if (!this.db) await this.initialize();

		const user = await this.getUserById(userId);
		if (!user) return false;

		const passwordHash = await this.hashPassword(password);
		if (user.passwordHash === passwordHash) return true;
		// Signed in with Google or ORCID here, this browser does not know the
		// password yet: the account server does, and this browser keeps it.
		if (user.passwordHash || this.isGuestUser(user)) return false;
		if (!(await accountSyncService.checkPassword(userId, password))) {
			return false;
		}
		const known = { ...user, passwordHash };
		await this.db?.put(this.USER_STORE, known);
		if (this.currentUser?.id === userId) this.currentUser = known;
		return true;
	}

	async updatePassword(
		userId: string,
		newPassword: string,
		currentPassword?: string,
	): Promise<User> {
		if (!this.db) await this.initialize();

		const user = await this.getUserById(userId);
		if (!user) throw new Error(t('User not found'));

		// The server account keeps the same password, or other devices could
		// no longer sign in with the new one.
		if (accountSyncService.getSession(userId)) {
			if (!currentPassword) {
				throw new Error(
					t('Current password is required to set a new password'),
				);
			}
			try {
				await accountSyncService.changePassword(
					userId,
					currentPassword,
					newPassword,
				);
			} catch (error) {
				moduleLog.warn('Password not changed on the server:', error);
				throw new Error(
					t(
						'The password could not be changed on the server. Check your connection and try again.',
					),
				);
			}
		}

		const passwordHash = await this.hashPassword(newPassword);

		const updatedUser = {
			...user,
			passwordHash,
		};

		return this.updateUser(updatedUser);
	}

	private async createNewDocumentUrl(
		projectId: string = generateYjsProjectId(),
		projectName = 'Untitled Project',
		projectDescription = '',
		projectType: ProjectType = 'latex',
		projectGroup: ProjectGroup = 'tex',
	): Promise<string> {
		try {
			const dbName = `texlyre-project-${projectId}`;
			const yjsCollection = `${dbName}-yjs_metadata`;

			const ydoc = new Y.Doc();
			const persistence = new IndexeddbPersistence(yjsCollection, ydoc);

			ydoc.transact(() => {
				const ymap = ydoc.getMap('data');

				ymap.set('documents', []);
				ymap.set('currentDocId', '');
				ymap.set('cursors', []);
				ymap.set('chatMessages', []);
				ymap.set('projectMetadata', {
					name: projectName,
					description: projectDescription,
					type: projectType,
					group: projectGroup,
				});
			});

			await new Promise<void>((resolve) => {
				const timeout = setTimeout(resolve, 2000);
				if (persistence.synced) {
					clearTimeout(timeout);
					resolve();
					return;
				}
				persistence.once('synced', () => {
					clearTimeout(timeout);
					resolve();
				});
			});

			persistence.destroy();
			ydoc.destroy();

			return `yjs:${projectId}`;
		} catch (error) {
			moduleLog.error('Error creating new document:', error);
			throw new Error(t('Failed to create document for project'));
		}
	}

	async createProject(project: ProjectCreateInput): Promise<Project> {
		const db = await this.getDatabase();
		const currentUser = this.currentUser;
		if (!currentUser) {
			throw new Error('User not authenticated');
		}

		const projectId = project.docUrl
			? project.docUrl.startsWith('yjs:')
				? project.docUrl.slice(4)
				: project.docUrl
			: generateYjsProjectId();

		const docUrl =
			project.docUrl ||
			(await this.createNewDocumentUrl(
				projectId,
				project.name,
				project.description,
				project.type,
				project.group,
			));

		const now = Date.now();
		const newProject: Project = {
			...project,
			docUrl,
			id: projectId,
			createdAt: now,
			updatedAt: now,
			ownerId: currentUser.id,
		};

		await db.put(this.PROJECT_STORE, newProject);
		accountSyncService.projectChanged(currentUser.id);
		// Whoever creates a project owns it on the collaboration server, so
		// that only they may replace its editing link.
		if (!project.docUrl) {
			void accountSyncService
				.projectAccess(projectId, { claim: true })
				.catch(() => {});
		}

		if (shouldAutoSync()) {
			diskBackupService.synchronize(newProject.id).catch(console.error);
		}

		return newProject;
	}

	async updateProject(project: Project): Promise<Project> {
		if (!this.db) await this.initialize();

		const existingProject = await this.db?.get(this.PROJECT_STORE, project.id);
		if (!existingProject) {
			throw new Error(t('Project not found'));
		}

		if (existingProject.ownerId !== this.currentUser?.id) {
			throw new Error(t('You do not have permission to update this project'));
		}

		const now = Date.now();
		const listedFieldsChanged = accountFieldsChanged(existingProject, project);
		const updatedProject: Project = {
			...project,
			updatedAt: now,
			...(listedFieldsChanged ? { accountUpdatedAt: now } : {}),
		};

		await this.db?.put(this.PROJECT_STORE, updatedProject);
		if (listedFieldsChanged) {
			accountSyncService.projectChanged(existingProject.ownerId);
		}

		if (shouldAutoSync() && !this.isGuestUser(this.currentUser)) {
			diskBackupService.synchronize(project.id).catch(console.error);
		}

		return updatedProject;
	}

	async createOrUpdateProject(
		project: Project,
		requireAuth = true,
	): Promise<Project> {
		const db = await this.getDatabase();

		if (!requireAuth) {
			const importedProject: Project = {
				...project,
				updatedAt: Date.now(),
			};
			await db.put(this.PROJECT_STORE, importedProject);
			return importedProject;
		}

		const currentUser = this.currentUser;
		if (!currentUser) {
			throw new Error(t('User not authenticated'));
		}

		if (project.id) {
			return this.updateProject({
				...project,
				ownerId: currentUser.id,
			});
		}
		return this.createProject({
			...project,
			docUrl: project.docUrl || (await this.createNewDocumentUrl()),
		});
	}

	async deleteProject(id: string): Promise<void> {
		if (!this.db) await this.initialize();

		const project = await this.db?.get(this.PROJECT_STORE, id);
		if (!project) {
			throw new Error(t('Project not found'));
		}

		if (project.ownerId !== this.currentUser?.id) {
			throw new Error(t('You do not have permission to delete this project'));
		}

		await this.db?.delete(this.PROJECT_STORE, id);
		await cleanupProjectDatabases(project);
		accountSyncService.projectDeleted(project.ownerId, id);

		if (shouldAutoSync() && !this.isGuestUser(this.currentUser)) {
			diskBackupService.synchronize().catch(console.error);
		}
	}

	async getProjectById(id: string): Promise<Project | null> {
		if (!this.db) await this.initialize();
		return this.db?.get(this.PROJECT_STORE, id);
	}

	async getProjectsByUser(userId?: string): Promise<Project[]> {
		const db = await this.getDatabase();

		const targetUserId = userId || this.currentUser?.id;
		if (!targetUserId) {
			return [];
		}

		const tx = db.transaction(this.PROJECT_STORE, 'readonly');
		const index = tx.store.index('ownerId');
		return index.getAll(targetUserId);
	}

	async getProjects(): Promise<Project[]> {
		return this.getProjectsByUser();
	}

	async getAllProjects(): Promise<Project[]> {
		if (!this.db) await this.initialize();
		return (await this.db?.getAll(this.PROJECT_STORE)) ?? [];
	}

	async getProjectsByTag(tag: string): Promise<Project[]> {
		const db = await this.getDatabase();

		if (!this.currentUser) {
			return [];
		}

		const tx = db.transaction(this.PROJECT_STORE, 'readonly');
		const index = tx.store.index('tags');
		const projects = await index.getAll(tag);

		return projects.filter(
			(project) => project.ownerId === this.currentUser?.id,
		);
	}

	async getProjectsByType(type: ProjectType): Promise<Project[]> {
		const db = await this.getDatabase();

		if (!this.currentUser) {
			return [];
		}
		const tx = db.transaction(this.PROJECT_STORE, 'readonly');
		const projects: Project[] = await tx.store.getAll();

		return projects.filter(
			(project) =>
				project.ownerId === this.currentUser?.id && project.type === type,
		);
	}

	async getProjectsByGroup(group: ProjectGroup): Promise<Project[]> {
		const db = await this.getDatabase();

		if (!this.currentUser) {
			return [];
		}

		const tx = db.transaction(this.PROJECT_STORE, 'readonly');
		const projects: Project[] = await tx.store.getAll();

		return projects.filter(
			(project) =>
				project.ownerId === this.currentUser?.id &&
				(project.group ?? project.type) === group,
		);
	}

	async searchProjects(query: string): Promise<Project[]> {
		const db = await this.getDatabase();

		if (!this.currentUser) {
			return [];
		}

		const tx = db.transaction(this.PROJECT_STORE, 'readonly');
		const projects: Project[] = await tx.store.getAll();

		const lowerQuery = query.toLowerCase();
		return projects.filter(
			(project) =>
				project.ownerId === this.currentUser?.id &&
				(project.name.toLowerCase().includes(lowerQuery) ||
					project.description.toLowerCase().includes(lowerQuery) ||
					project.type.toLowerCase().includes(lowerQuery) ||
					project.group?.toLowerCase().includes(lowerQuery) ||
					project.tags.some((tag) => tag.toLowerCase().includes(lowerQuery))),
		);
	}

	async filterProjects(
		query = '',
		tag = '',
		type: ProjectType | '' = '',
		group: ProjectGroup | '' = '',
	): Promise<Project[]> {
		const db = await this.getDatabase();

		if (!this.currentUser) {
			return [];
		}

		const tx = db.transaction(this.PROJECT_STORE, 'readonly');
		const projects: Project[] = await tx.store.getAll();
		const lowerQuery = query.trim().toLowerCase();

		return projects.filter(
			(project) =>
				project.ownerId === this.currentUser?.id &&
				(!tag || project.tags.includes(tag)) &&
				(!type || project.type === type) &&
				(!group || (project.group ?? project.type) === group) &&
				(!lowerQuery ||
					project.name.toLowerCase().includes(lowerQuery) ||
					project.description.toLowerCase().includes(lowerQuery) ||
					project.type.toLowerCase().includes(lowerQuery) ||
					(project.group ?? project.type).toLowerCase().includes(lowerQuery) ||
					project.tags.some((projectTag) =>
						projectTag.toLowerCase().includes(lowerQuery),
					)),
		);
	}

	async toggleFavorite(projectId: string): Promise<Project> {
		if (!this.db) await this.initialize();

		const project = await this.db?.get(this.PROJECT_STORE, projectId);
		if (!project) {
			throw new Error(t('Project not found'));
		}

		if (project.ownerId !== this.currentUser?.id) {
			throw new Error(t('You do not have permission to modify this project'));
		}

		const now = Date.now();
		const updatedProject: Project = {
			...project,
			isFavorite: !project.isFavorite,
			updatedAt: now,
			accountUpdatedAt: now,
		};

		await this.db?.put(this.PROJECT_STORE, updatedProject);
		accountSyncService.projectChanged(project.ownerId);
		return updatedProject;
	}

	// Writes a project as the account lists it, from another device.
	async storeSyncedProject(project: Project): Promise<void> {
		const db = await this.getDatabase();
		await db.put(this.PROJECT_STORE, project);
	}

	// Removes a project deleted on another device from this one.
	async removeSyncedProject(project: Project): Promise<void> {
		const db = await this.getDatabase();
		await db.delete(this.PROJECT_STORE, project.id);
		await cleanupProjectDatabases(project);
	}
}

export const authService = new AuthService();

accountSyncService.attachStore({
	getProjects: (userId) => authService.getProjectsByUser(userId),
	storeProject: (project) => authService.storeSyncedProject(project),
	removeProject: (project) => authService.removeSyncedProject(project),
});

personalDictionaryService.followUser(
	() => authService.getCurrentUser()?.id ?? null,
);
accountSyncService.attachDictionary(personalDictionaryService);

accountPreferencesService.attachProfiles({
	profileOf: (userId) => authService.getUserById(userId),
	applyProfile: (userId, profile) =>
		authService.applySyncedProfile(userId, profile),
});
accountSyncService.attachPreferences(accountPreferencesService);
