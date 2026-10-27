// src/services/AccountSyncService.ts
import { createNamedLogger } from '@/logging';
import type { Project } from '../types/projects';
import type { DictionaryEntry } from '../types/spelling';
import {
	type AccountProject,
	getAccountServerUrl,
	planAccountSync,
	toAccountProject,
} from '../utils/accountSyncUtils';
import { isReadOnlyProjectId, isValidYjsProjectId } from '../utils/urlUtils';
import { projectLinkService } from './ProjectLinkService';

const moduleLog = createNamedLogger('AccountSyncService');

export const ACCOUNT_PROJECTS_CHANGED = 'feuillet-account-projects-changed';

const REQUEST_TIMEOUT_MS = 15_000;
const CHANGE_DELAY_MS = 1_500;
const SYNC_INTERVAL_MS = 2 * 60_000;
const FOCUS_THROTTLE_MS = 30_000;

export interface AccountSession {
	username: string;
	token: string;
	server: string;
}

export type AccountSyncState =
	| 'unlinked'
	| 'syncing'
	| 'synced'
	| 'offline'
	| 'signed-out';

export interface AccountSyncStatus {
	state: AccountSyncState;
	username?: string;
	server?: string;
	lastSync?: number;
}

// How the account server answered: `unreachable` when it could not be
// reached at all, otherwise the error code it returned.
export class AccountServerError extends Error {
	constructor(
		readonly code: string,
		readonly status = 0,
	) {
		super(code);
	}
}

// A project's editing link as an account sees it: whether the account owns
// the project and, if so, the id the server opens it under.
export interface ProjectAccess {
	owner: 'you' | 'other' | 'none';
	edit?: string;
}

export interface AccountProjectStore {
	getProjects(userId: string): Promise<Project[]>;
	storeProject(project: Project): Promise<void>;
	removeProject(project: Project): Promise<void>;
}

export interface AccountDictionaryStore {
	entries(userId: string): DictionaryEntry[];
	merge(userId: string, entries: unknown[]): void;
	addListener(listener: (userId: string, local: boolean) => void): () => void;
}

const sessionKey = (userId: string) => `feuillet-account-${userId}`;
const deletionsKey = (userId: string) => `feuillet-account-${userId}-deleted`;
// The server account a local account was linked to, kept after signing out.
const linkedKey = (userId: string) => `feuillet-account-${userId}-linked`;

const readJson = <T>(key: string, fallback: T): T => {
	try {
		const raw = localStorage.getItem(key);
		return raw ? (JSON.parse(raw) as T) : fallback;
	} catch {
		return fallback;
	}
};

// Keeps the local project list, and the user's own spelling dictionary, in
// step with the Feuillet account on the collaboration server, so that every
// device shows the same projects and accepts the same words.
class AccountSyncService {
	private store: AccountProjectStore | null = null;
	private dictionary: AccountDictionaryStore | null = null;
	private userId: string | null = null;
	private running: Promise<void> | null = null;
	private runAgain = false;
	private changeTimer: ReturnType<typeof setTimeout> | null = null;
	private intervalTimer: ReturnType<typeof setInterval> | null = null;
	private lastFocusSync = 0;
	private status: AccountSyncStatus = { state: 'unlinked' };
	private listeners: Set<(status: AccountSyncStatus) => void> = new Set();

	constructor() {
		// When a project's link stops opening it, its owner moves on to the
		// current one.
		projectLinkService.setRecovery(async (projectId) =>
			isReadOnlyProjectId(projectId)
				? null
				: ((await this.projectAccess(projectId))?.edit ?? null),
		);
	}

	attachStore(store: AccountProjectStore): void {
		this.store = store;
	}

	attachDictionary(dictionary: AccountDictionaryStore): void {
		this.dictionary = dictionary;
		// Words added or removed here reach the server shortly after.
		dictionary.addListener((userId, local) => {
			if (local) this.projectChanged(userId);
		});
	}

	serverFor(userId?: string | null): string {
		return getAccountServerUrl(userId);
	}

	getSession(userId: string): AccountSession | null {
		const session = readJson<AccountSession | null>(sessionKey(userId), null);
		return session?.token && session.server ? session : null;
	}

	saveSession(userId: string, session: AccountSession): void {
		localStorage.setItem(sessionKey(userId), JSON.stringify(session));
		localStorage.setItem(linkedKey(userId), session.username.toLowerCase());
	}

	// Whether this local account was ever linked to the server account named
	// `username`: only then may that account's password replace the local one.
	wasLinkedTo(userId: string, username: string): boolean {
		return localStorage.getItem(linkedKey(userId)) === username.toLowerCase();
	}

	clearSession(userId: string): void {
		localStorage.removeItem(sessionKey(userId));
		localStorage.removeItem(deletionsKey(userId));
	}

	async register(
		server: string,
		username: string,
		password: string,
	): Promise<AccountSession> {
		const result = await this.request(server, 'POST', '/account/register', {
			body: { username, password },
		});
		return { username: result.username, token: result.token, server };
	}

	async login(
		server: string,
		username: string,
		password: string,
	): Promise<AccountSession> {
		const result = await this.request(server, 'POST', '/account/login', {
			body: { username, password },
		});
		return { username: result.username, token: result.token, server };
	}

	async changePassword(
		userId: string,
		password: string,
		newPassword: string,
	): Promise<void> {
		const session = this.getSession(userId);
		if (!session) return;
		await this.request(session.server, 'POST', '/account/password', {
			token: session.token,
			body: { password, newPassword },
		});
	}

	async deleteAccount(userId: string, password: string): Promise<void> {
		const session = this.getSession(userId);
		if (!session) return;
		await this.request(session.server, 'DELETE', '/account', {
			token: session.token,
			body: { password },
		});
		this.clearSession(userId);
		localStorage.removeItem(linkedKey(userId));
	}

	// Ends a session the server opened but this device will not use.
	async endSession(session: AccountSession): Promise<void> {
		await this.request(session.server, 'POST', '/account/logout', {
			token: session.token,
		}).catch(() => {});
	}

	// Signs this device out of the account; the server forgets its session
	// when it can be reached.
	async signOut(userId: string): Promise<void> {
		const session = this.getSession(userId);
		this.stop();
		this.clearSession(userId);
		if (!session) return;
		await this.request(session.server, 'POST', '/account/logout', {
			token: session.token,
		}).catch(() => {});
	}

	// Starts keeping a signed-in user's projects in step: now, when the window
	// comes back, and every few minutes.
	start(userId: string): void {
		if (this.userId !== userId) this.stop();
		this.userId = userId;
		this.updateStatus();
		if (!this.getSession(userId)) return;

		if (!this.intervalTimer) {
			this.intervalTimer = setInterval(
				() => void this.sync(userId),
				SYNC_INTERVAL_MS,
			);
			window.addEventListener('focus', this.handleFocus);
			window.addEventListener('online', this.handleFocus);
		}
		void this.sync(userId);
	}

	stop(): void {
		if (this.intervalTimer) clearInterval(this.intervalTimer);
		if (this.changeTimer) clearTimeout(this.changeTimer);
		this.intervalTimer = null;
		this.changeTimer = null;
		this.userId = null;
		window.removeEventListener('focus', this.handleFocus);
		window.removeEventListener('online', this.handleFocus);
		this.setStatus({ state: 'unlinked' });
	}

	/**
	 * Asks the collaboration server about a project's editing link, for the
	 * signed-in account: `claim` makes the account its owner if it has none,
	 * and `reset` (owner only) replaces the link, cutting off the old one.
	 * Null when no account is signed in.
	 */
	async projectAccess(
		projectId: string,
		options: { claim?: boolean; reset?: boolean } = {},
	): Promise<ProjectAccess | null> {
		const userId = this.userId;
		const session = userId ? this.getSession(userId) : null;
		if (!userId || !session) return null;

		const result = await this.request(session.server, 'POST', '/share/edit', {
			token: session.token,
			body: { project: projectLinkService.serverId(projectId), ...options },
		});
		const owner = ['you', 'other', 'none'].includes(result?.owner)
			? (result.owner as ProjectAccess['owner'])
			: 'none';
		const edit =
			typeof result?.edit === 'string' &&
			isValidYjsProjectId(result.edit) &&
			!isReadOnlyProjectId(result.edit)
				? result.edit
				: undefined;
		if (edit) await this.rememberEditLink(userId, projectId, edit);
		return { owner, edit };
	}

	// Opens the project under `editId` from now on, here and, through the
	// account, on the user's other devices.
	private async rememberEditLink(
		userId: string,
		projectId: string,
		editId: string,
	): Promise<void> {
		projectLinkService.setServerId(projectId, editId);
		const project = (await this.store?.getProjects(userId))?.find(
			(candidate) => candidate.docUrl === `yjs:${projectId}`,
		);
		const stored = editId === projectId ? undefined : editId;
		if (!this.store || !project || project.editId === stored) return;
		await this.store.storeProject({
			...project,
			editId: stored,
			accountUpdatedAt: Date.now(),
		});
		this.projectChanged(userId);
	}

	projectChanged(userId: string): void {
		if (!this.getSession(userId)) return;
		if (this.changeTimer) clearTimeout(this.changeTimer);
		this.changeTimer = setTimeout(() => {
			this.changeTimer = null;
			void this.sync(userId);
		}, CHANGE_DELAY_MS);
	}

	projectDeleted(userId: string, projectId: string): void {
		if (!this.getSession(userId)) return;
		const deletions = readJson<AccountProject[]>(deletionsKey(userId), []);
		deletions.push({ id: projectId, updatedAt: Date.now(), deleted: true });
		localStorage.setItem(deletionsKey(userId), JSON.stringify(deletions));
		this.projectChanged(userId);
	}

	sync(userId: string): Promise<void> {
		if (this.running) {
			this.runAgain = true;
			return this.running;
		}
		this.running = this.runSync(userId).finally(() => {
			this.running = null;
		});
		return this.running;
	}

	getStatus(): AccountSyncStatus {
		return this.status;
	}

	addListener(listener: (status: AccountSyncStatus) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private handleFocus = () => {
		if (!this.userId || Date.now() - this.lastFocusSync < FOCUS_THROTTLE_MS) {
			return;
		}
		this.lastFocusSync = Date.now();
		void this.sync(this.userId);
	};

	private async runSync(userId: string): Promise<void> {
		do {
			this.runAgain = false;
			const session = this.getSession(userId);
			if (!session || !this.store) return;

			this.updateStatus('syncing');
			try {
				const local = await this.store.getProjects(userId);
				const deletions = readJson<AccountProject[]>(deletionsKey(userId), []);
				const { projects } = await this.request(
					session.server,
					'POST',
					'/account/projects',
					{
						token: session.token,
						body: {
							projects: [...local.map(toAccountProject), ...deletions],
						},
					},
				);
				this.forgetDeletions(userId, deletions);

				const plan = planAccountSync(
					await this.store.getProjects(userId),
					projects as AccountProject[],
					userId,
				);
				for (const project of [...plan.create, ...plan.update]) {
					await this.store.storeProject(project);
				}
				for (const project of plan.remove) {
					await this.store.removeProject(project);
				}
				// Projects whose editing link was replaced on another device.
				for (const project of await this.store.getProjects(userId)) {
					if (project.editId && project.docUrl.startsWith('yjs:')) {
						projectLinkService.setServerId(
							project.docUrl.slice(4),
							project.editId,
						);
					}
				}
				if (plan.create.length + plan.update.length + plan.remove.length) {
					window.dispatchEvent(new CustomEvent(ACCOUNT_PROJECTS_CHANGED));
				}
				await this.syncDictionary(session, userId);
				this.updateStatus('synced', Date.now());
			} catch (error) {
				if (error instanceof AccountServerError && error.status === 401) {
					moduleLog.info('The account session ended on the server');
					this.clearSession(userId);
					this.updateStatus('signed-out');
					return;
				}
				moduleLog.warn('Project list sync failed:', error);
				this.updateStatus('offline');
				return;
			}
		} while (this.runAgain);
	}

	private async syncDictionary(
		session: AccountSession,
		userId: string,
	): Promise<void> {
		if (!this.dictionary) return;
		try {
			const { words } = await this.request(
				session.server,
				'POST',
				'/account/dictionary',
				{
					token: session.token,
					body: { words: this.dictionary.entries(userId) },
				},
			);
			if (Array.isArray(words)) this.dictionary.merge(userId, words);
		} catch (error) {
			// A server without dictionaries still keeps the projects in step.
			if (error instanceof AccountServerError && error.status === 404) {
				moduleLog.info('The account server keeps no dictionaries');
				return;
			}
			throw error;
		}
	}

	private forgetDeletions(userId: string, sent: AccountProject[]): void {
		const sentKeys = new Set(
			sent.map((entry) => `${entry.id}@${entry.updatedAt}`),
		);
		const remaining = readJson<AccountProject[]>(
			deletionsKey(userId),
			[],
		).filter((entry) => !sentKeys.has(`${entry.id}@${entry.updatedAt}`));
		if (remaining.length) {
			localStorage.setItem(deletionsKey(userId), JSON.stringify(remaining));
		} else {
			localStorage.removeItem(deletionsKey(userId));
		}
	}

	private updateStatus(state?: AccountSyncState, lastSync?: number): void {
		if (!this.userId) return;
		const session = this.getSession(this.userId);
		this.setStatus({
			state: state ?? (session ? this.status.state : 'unlinked'),
			username: session?.username,
			server: session?.server,
			lastSync: lastSync ?? this.status.lastSync,
		});
	}

	private setStatus(status: AccountSyncStatus): void {
		this.status = status;
		this.listeners.forEach((listener) => {
			listener(status);
		});
	}

	private async request(
		server: string,
		method: string,
		path: string,
		{ token, body }: { token?: string; body?: unknown } = {},
	): Promise<any> {
		if (!server) throw new AccountServerError('unreachable');

		let response: Response;
		try {
			response = await fetch(`${server}${path}`, {
				method,
				headers: {
					...(body ? { 'Content-Type': 'application/json' } : {}),
					...(token ? { Authorization: `Bearer ${token}` } : {}),
				},
				body: body ? JSON.stringify(body) : undefined,
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
		} catch {
			throw new AccountServerError('unreachable');
		}

		const result = await response.json().catch(() => ({}));
		if (!response.ok) {
			throw new AccountServerError(
				result?.error ?? 'server_error',
				response.status,
			);
		}
		return result;
	}
}

export const accountSyncService = new AccountSyncService();
