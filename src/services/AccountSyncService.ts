// src/services/AccountSyncService.ts
import { createNamedLogger } from '@/logging';
import type { Project } from '../types/projects';
import type { DictionaryEntry } from '../types/spelling';
import type { PreferenceEntry } from '../utils/accountPreferences';
import type { AnnotationPart } from '../utils/grammarText';
import {
	type AccountProject,
	getAccountServerUrl,
	planAccountSync,
	toAccountProject,
} from '../utils/accountSyncUtils';
import {
	type ProjectLinkKind,
	isValidYjsProjectId,
	projectLinkKind,
} from '../utils/urlUtils';
import type { ProviderTicket, SignInProvider } from './ExternalSignInService';
import { projectLinkService } from './ProjectLinkService';

const moduleLog = createNamedLogger('AccountSyncService');

export const ACCOUNT_PROJECTS_CHANGED = 'feuillet-account-projects-changed';

const REQUEST_TIMEOUT_MS = 15_000;
// Requests that wait for the server to mail something: a mail provider may
// take its time, as Gmail does, holding back its greeting for seconds.
const MAIL_TIMEOUT_MS = 60_000;
const CHANGE_DELAY_MS = 1_500;
const SYNC_INTERVAL_MS = 2 * 60_000;
const FOCUS_THROTTLE_MS = 30_000;

export interface AccountSession {
	username: string;
	token: string;
	server: string;
}

/**
 * What the privacy page says of this server in particular
 * (server/collab/site.js).
 */
export interface SiteInfo {
	/** Whom to ask: an email address or a web page; null, the code's issues. */
	contact: string | null;
	/** The service that sends the emails; null when the server sends none. */
	mail: { provider: string | null; privacy: string | null } | null;
	webLogDays: number;
	/** Nightly backups kept (0: all); null until one is made. */
	backupDays: number | null;
	signIn: { google: boolean; orcid: boolean };
	grammar: boolean;
}

/** Two-factor authentication (server/collab/accounts.js). */
export interface TwoFactorStatus {
	enabled: boolean;
	enabledAt?: number;
	/** Recovery codes left, which replace a code when the phone is lost. */
	recoveryCodes: number;
}

const twoFactorStatusOf = (result: any): TwoFactorStatus => ({
	enabled: result?.enabled === true,
	...(Number.isFinite(result?.enabledAt)
		? { enabledAt: result.enabledAt }
		: {}),
	recoveryCodes: Number.isInteger(result?.recoveryCodes)
		? result.recoveryCodes
		: 0,
});

/** Who may create an account on the server (server/collab/accounts.js). */
export interface SignUpOptions {
	mode: 'open' | 'invitation';
	domains: string[];
}

/** A link to create an account, as the administration page lists it. */
export interface AdminSignUpLink {
	id: string;
	createdAt: number;
	expiresAt: number;
	/** The administrator who made it; empty for a mailed one. */
	by: string;
	mailed: boolean;
}

export interface AdminSignUpLinks extends SignUpOptions {
	links: AdminSignUpLink[];
}

/** A ticket to compile on the TeX Live server, and when it ends (ms). */
export interface CompileTicket {
	ticket: string;
	expiresAt: number;
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

// A project's links as an account sees them: who owns the project, the
// account's role in it, and the current editing link (for its owner and
// editors), review link (for its reviewers) or read-only link (for its
// readers).
export interface ProjectAccess {
	owner: 'you' | 'other' | 'none';
	role: ProjectRole | null;
	edit?: string;
	review?: string;
	view?: string;
	/** For the owner: how many access requests wait. */
	requests?: number;
	/** For whoever asked: the role asked for, until the owner decides. */
	requested?: RequestedRole;
}

/** What one may ask a project's owner for, as Overleaf's "Request access". */
export type RequestedRole = 'editor' | 'reviewer';

/** An access request, as its project's owner sees it. */
export interface AccessRequest {
	username: string;
	role: RequestedRole;
	createdAt: number;
}

/** Told when a project's access requests change (useAccessRequests). */
export const ACCESS_REQUESTS_CHANGED = 'feuillet:access-requests-changed';

const REQUESTED_ROLES: readonly string[] = ['editor', 'reviewer'];

export type MemberRole = 'editor' | 'reviewer' | 'reader';
export type ProjectRole = 'owner' | MemberRole;
const MEMBER_ROLES: readonly string[] = ['editor', 'reviewer', 'reader'];

export interface ProjectMember {
	username: string;
	role: MemberRole;
}

/** An account that lists a project by a link given it, not invited. */
export interface ProjectVisitor {
	username: string;
	access: 'edit' | 'review' | 'view';
	since?: number;
}

/** Who works on a project, as its people see it (shares.js). */
export interface ProjectPeople {
	owner?: string;
	members: ProjectMember[];
	visitors: ProjectVisitor[];
}

/** A pending invitation: its link holds `invite`. */
/** An application that works on the account's projects, as Claude. */
export interface AssistantConnection {
	id: string;
	name: string;
	createdAt: number;
	lastUsedAt: number;
}

/**
 * A Git token, as the profile lists it: never the token itself, shown only
 * when it is made (server/collab/accounts.js).
 */
export interface GitToken {
	id: string;
	label: string;
	/** Its first characters, to tell it apart. */
	hint: string;
	createdAt: number;
	lastUsedAt?: number;
}

const gitTokensOf = (result: { tokens?: unknown } | null): GitToken[] =>
	Array.isArray(result?.tokens)
		? (result.tokens as GitToken[]).filter(
				(entry) =>
					typeof entry?.id === 'string' && typeof entry.createdAt === 'number',
			)
		: [];

// A device signed in to the account, as Overleaf's sessions list them.
export interface AccountDevice {
	id: string;
	current: boolean;
	createdAt: number;
	lastUsedAt: number;
	browser?: string;
	os?: string;
}

export interface ProjectInvite {
	invite: string;
	role: MemberRole;
	createdAt: number;
	expiresAt: number;
	/** The address it was mailed to, if any. */
	email?: string;
}

/**
 * Whether the server mails invitations: "yes", "unconfirmed" (not until the
 * owner's account email is confirmed) or "no". Null from an older server.
 */
export type InviteMailing = 'yes' | 'unconfirmed' | 'no';

export interface ProjectInvites {
	invite?: ProjectInvite;
	invites: ProjectInvite[];
	sends: InviteMailing | null;
	/** The invitation was mailed. */
	mailed?: boolean;
	/** Why it was not: mail_quota, mail_failed, email_unconfirmed... */
	mailError?: string;
}

export interface RecoveryEmailStatus {
	/** Whether the server sends mail at all. */
	enabled: boolean;
	address?: string;
	/** An address whose confirmation link was mailed. */
	pending?: string;
}

const recoveryEmailStatus = (result: any): RecoveryEmailStatus => ({
	enabled: result?.enabled === true,
	...(typeof result?.address === 'string' ? { address: result.address } : {}),
	...(typeof result?.pending === 'string' ? { pending: result.pending } : {}),
});

/** Whether the account is linked to a Google or ORCID account. */
export interface LinkStatus {
	/** Whether the server signs in with that site at all. */
	enabled: boolean;
	linked: boolean;
	linkedAt?: number;
}

const linkStatusOf = (result: any): LinkStatus => ({
	enabled: result?.enabled === true,
	linked: result?.linked === true,
	...(typeof result?.linkedAt === 'number'
		? { linkedAt: result.linkedAt }
		: {}),
});

/**
 * An account as the administration page shows it: never its address, its
 * password or its projects' names.
 */
export interface AdminAccount {
	id: string;
	username: string;
	createdAt: number;
	lastUsedAt?: number;
	/** Devices signed in. */
	devices: number;
	email: 'confirmed' | 'pending' | 'none';
	/** Whether it signs in with two-factor authentication. */
	twoFactor?: boolean;
	/** Projects in its list, its own and others'. */
	listed: number;
	/** Projects it owns, and the bytes their files and versions take. */
	owned: number;
	bytes: number;
	memberOf: number;
	/** Named in the server's ADMIN_ACCOUNTS. */
	admin: boolean;
}

/**
 * A project no one can find any more, as the administration page shows it:
 * under a key, never its id or name. "none": no account owns or lists it;
 * "gone": the account that owned it was deleted; "unlisted": its owner's
 * list no longer names it; "deleted": deleted, but its contents remain.
 */
export interface AdminOrphan {
	key: string;
	reason: 'none' | 'gone' | 'unlisted' | 'deleted';
	members: number;
	/** Its files and versions. */
	bytes: number;
	changedAt?: number;
	/** Someone has it open now. */
	open: boolean;
}

const ORPHAN_REASONS = ['none', 'gone', 'unlisted', 'deleted'];

export interface AdminOverview {
	/** The id of the account asking. */
	you: string;
	server: {
		startedAt: number;
		documents: number;
		connections: number;
		projects: number;
		unowned: number;
		disk: {
			documents: number;
			files: number;
			versions: number;
			accounts: number;
			/** The projects' Git repositories. */
			git?: number;
			free?: number;
		};
	};
	/** Null when the server sends no email. */
	mail: {
		sent: number;
		limit: number;
		invitationLimit: number;
		/** Counted since then, the server's start. */
		since: number;
	} | null;
	/** Null when no backup has told how it went. */
	backup: {
		last?: {
			time: number;
			bytes: number;
			kept: number;
			copy: 'none' | 'done' | 'failed';
		};
		/** A backup that failed after the last one made. */
		failed?: { time: number; error: string };
	} | null;
	/**
	 * The TeX Live servers (server/texlive/server.js, GET /status): null when
	 * the collaboration server does not reach them, ok false when they do
	 * not answer.
	 */
	compile?: AdminCompileStatus | null;
	/** LanguageTool: null on an older server. */
	grammar?: { enabled: boolean; ok?: boolean } | null;
	accounts: AdminAccount[];
	orphans: AdminOrphan[];
}

/** A TeX Live server's load, and what it did since it started. */
export interface AdminCompileStatus {
	ok: boolean;
	year?: number | null;
	shellEscape?: 'full' | 'restricted';
	maxConcurrent?: number;
	maxQueue?: number;
	connections?: number;
	compiling?: number;
	queued?: number;
	accountsCompiling?: number;
	accountsWaiting?: number;
	since?: number;
	compiles?: number;
	failed?: number;
	timedOut?: number;
	refused?: number;
	compileMs?: number;
	waited?: number;
	waitMs?: number;
	longestWaitMs?: number;
	/** The other years' servers. */
	others?: AdminCompileStatus[];
}

export interface MembersChange {
	add?: ProjectMember;
	remove?: string;
	// A member made the owner, as Overleaf's "Make owner"; the owner stays
	// on as an editor.
	transfer?: string;
	// What the invited account's project list shows.
	name?: string;
	type?: string;
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

/** A grammar or style mistake LanguageTool found in a paragraph. */
export interface GrammarMatch {
	offset: number;
	length: number;
	message: string;
	shortMessage: string;
	replacements: string[];
	rule: { id: string; category: string; issueType: string };
}

export interface AccountPreferencesStore {
	entries(userId: string): Promise<PreferenceEntry[]>;
	merge(
		userId: string,
		sent: PreferenceEntry[],
		answer: unknown[],
	): Promise<void>;
	addListener(listener: (userId: string) => void): () => void;
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

// Keeps the local project list, the user's own spelling dictionary and their
// preferences in step with the Feuillet account on the collaboration server,
// so that every device shows the same projects, accepts the same words and
// looks the same.
class AccountSyncService {
	private store: AccountProjectStore | null = null;
	private dictionary: AccountDictionaryStore | null = null;
	private preferences: AccountPreferencesStore | null = null;
	private grammarAvailability: {
		server: string;
		at: number;
		enabled: boolean;
	} | null = null;
	private userId: string | null = null;
	private running: Promise<void> | null = null;
	private runAgain = false;
	private changeTimer: ReturnType<typeof setTimeout> | null = null;
	private intervalTimer: ReturnType<typeof setInterval> | null = null;
	private lastFocusSync = 0;
	private status: AccountSyncStatus = { state: 'unlinked' };
	// Whether the account signed in with this token administers the server.
	private adminCheck: { token: string; admin: Promise<boolean> } | null = null;
	private listeners: Set<(status: AccountSyncStatus) => void> = new Set();

	constructor() {
		// When a project's link stops opening it, its owner and invited
		// collaborators move on to the current one.
		projectLinkService.setRecovery(async (projectId) => {
			const access = await this.projectAccess(projectId);
			return access?.[projectLinkKind(projectId)] ?? null;
		});
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

	attachPreferences(preferences: AccountPreferencesStore): void {
		this.preferences = preferences;
		// Preferences changed here reach the server shortly after.
		preferences.addListener((userId) => this.projectChanged(userId));
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

	/**
	 * Creates the account on the server; with a ticket of Google's or
	 * ORCID's sign-in, linked to that account.
	 */
	async register(
		server: string,
		username: string,
		password: string,
		link?: ProviderTicket,
		admission: { invite?: string; signup?: string } = {},
	): Promise<AccountSession> {
		const result = await this.request(server, 'POST', '/account/register', {
			body: {
				username,
				password,
				...(link ? { [`${link.provider}Ticket`]: link.ticket } : {}),
				...admission,
			},
		});
		return { username: result.username, token: result.token, server };
	}

	/**
	 * Who may create an account on the server: anyone, or only with an
	 * invitation; and the email domains whose addresses may ask for a link
	 * to create one. Null when the server does not tell.
	 */
	async signUpOptions(): Promise<SignUpOptions | null> {
		const server = this.serverFor(this.userId);
		if (!server) return null;
		try {
			const result = await this.request(server, 'GET', '/account/sign-up');
			return {
				mode: result?.mode === 'invitation' ? 'invitation' : 'open',
				domains: Array.isArray(result?.domains)
					? result.domains.filter((entry: unknown) => typeof entry === 'string')
					: [],
			};
		} catch {
			return null;
		}
	}

	/** What the privacy page says of this server; null when it does not tell. */
	async siteInfo(): Promise<SiteInfo | null> {
		const server = this.serverFor(this.userId);
		if (!server) return null;
		try {
			const result = await this.request(server, 'GET', '/site');
			const text = (value: unknown) =>
				typeof value === 'string' && value ? value : null;
			const days = (value: unknown) =>
				Number.isInteger(value) && (value as number) >= 0
					? (value as number)
					: null;
			return {
				contact: text(result?.contact),
				mail:
					result?.mail && typeof result.mail === 'object'
						? {
								provider: text(result.mail.provider),
								privacy: text(result.mail.privacy),
							}
						: null,
				webLogDays: days(result?.webLogDays) ?? 14,
				backupDays: days(result?.backupDays),
				signIn: {
					google: result?.signIn?.google === true,
					orcid: result?.signIn?.orcid === true,
				},
				grammar: result?.grammar === true,
			};
		} catch {
			return null;
		}
	}

	/** A link to create an account, mailed to an address of those domains. */
	async mailSignUpLink(email: string, language: string): Promise<void> {
		const server = this.serverFor(this.userId);
		await this.request(server, 'POST', '/account/sign-up', {
			body: { email, language },
			timeout: MAIL_TIMEOUT_MS,
		});
	}

	/**
	 * Signs in to the account a Google or ORCID account is linked to; fails
	 * with `<provider>_not_linked` when it is linked to none, the ticket
	 * staying good for creating one.
	 */
	async loginWithProvider(
		server: string,
		provider: SignInProvider,
		ticket: string,
		code?: string,
	): Promise<AccountSession> {
		const result = await this.request(
			server,
			'POST',
			`/account/${provider}/login`,
			{ body: code ? { ticket, code } : { ticket } },
		);
		return { username: result.username, token: result.token, server };
	}

	/** Whether two-factor authentication is on; null signed out. */
	async twoFactorStatus(): Promise<TwoFactorStatus | null> {
		const session = this.userId ? this.getSession(this.userId) : null;
		if (!session) return null;
		const result = await this.request(
			session.server,
			'GET',
			'/account/two-factor',
			{ token: session.token },
		);
		return twoFactorStatusOf(result);
	}

	/**
	 * Begins two-factor authentication, with the password: a new secret for
	 * an authenticator app, and its otpauth:// address for a QR code.
	 */
	async beginTwoFactor(
		password: string,
	): Promise<{ secret: string; uri: string } | null> {
		const session = this.userId ? this.getSession(this.userId) : null;
		if (!session) return null;
		const result = await this.request(
			session.server,
			'POST',
			'/account/two-factor',
			{ token: session.token, body: { password } },
		);
		return typeof result?.secret === 'string' && typeof result.uri === 'string'
			? { secret: result.secret, uri: result.uri }
			: null;
	}

	/**
	 * Turns two-factor authentication on with a code of the new secret's;
	 * with the recovery codes made then, when the account had none.
	 */
	async confirmTwoFactor(
		code: string,
	): Promise<(TwoFactorStatus & { codes?: string[] }) | null> {
		const session = this.userId ? this.getSession(this.userId) : null;
		if (!session) return null;
		const result = await this.request(
			session.server,
			'POST',
			'/account/two-factor',
			{ token: session.token, body: { code } },
		);
		return {
			...twoFactorStatusOf(result),
			...(Array.isArray(result?.codes)
				? {
						codes: result.codes.filter(
							(entry: unknown) => typeof entry === 'string',
						),
					}
				: {}),
		};
	}

	/** Turns it off, with the password and a code (or a recovery code). */
	async disableTwoFactor(
		password: string,
		code: string,
	): Promise<TwoFactorStatus | null> {
		const session = this.userId ? this.getSession(this.userId) : null;
		if (!session) return null;
		const result = await this.request(
			session.server,
			'POST',
			'/account/two-factor',
			{ token: session.token, body: { password, code, remove: true } },
		);
		return twoFactorStatusOf(result);
	}

	/**
	 * A ticket to compile on the TeX Live server (server/collab/
	 * compileTickets.js): the account's, or else one by the link of the
	 * project open, when an account owns that project. null when the server
	 * makes none; AccountServerError `account_required` when it wants an
	 * account.
	 */
	async compileTicket(project?: string): Promise<CompileTicket | null> {
		const userId = this.userId;
		const session = userId ? this.getSession(userId) : null;
		const server = session?.server || this.serverFor(userId);
		if (!server) return null;
		const ask = (options: { token?: string; body?: unknown }) =>
			this.request(server, 'POST', '/compile/ticket', options);
		let result: any;
		try {
			if (session) {
				try {
					result = await ask({ token: session.token });
				} catch (error) {
					// Signed out on the server: the project's link may still do.
					if (!(error instanceof AccountServerError && error.status === 401)) {
						throw error;
					}
				}
			}
			result ??= await ask({ body: { project } });
		} catch (error) {
			// A server that makes none, or older.
			if (error instanceof AccountServerError && error.status === 404) {
				return null;
			}
			throw error;
		}
		return typeof result?.ticket === 'string' &&
			Number.isFinite(result.expiresAt)
			? { ticket: result.ticket, expiresAt: result.expiresAt }
			: null;
	}

	/** Whether the account is linked to a site's account; null signed out. */
	async linkStatus(provider: SignInProvider): Promise<LinkStatus | null> {
		const userId = this.userId;
		const session = userId ? this.getSession(userId) : null;
		if (!userId || !session) return null;
		const result = await this.request(
			session.server,
			'GET',
			`/account/${provider}`,
			{ token: session.token },
		);
		return linkStatusOf(result);
	}

	/** Links the account to the site's account of a ticket, or, with null, unlinks it. */
	async setLink(
		provider: SignInProvider,
		ticket: string | null,
		password: string,
	): Promise<LinkStatus | null> {
		const userId = this.userId;
		const session = userId ? this.getSession(userId) : null;
		if (!userId || !session) return null;
		const result = await this.request(
			session.server,
			'POST',
			`/account/${provider}`,
			{
				token: session.token,
				body:
					ticket === null ? { password, remove: true } : { password, ticket },
			},
		);
		return linkStatusOf(result);
	}

	/**
	 * Whether `password` is the account's, as the server says: for a device
	 * that signed in with Google or ORCID and so does not know it. False
	 * when it cannot say.
	 */
	async checkPassword(userId: string, password: string): Promise<boolean> {
		const session = this.getSession(userId);
		if (!session) return false;
		try {
			await this.request(session.server, 'POST', '/account/password/verify', {
				token: session.token,
				body: { password },
			});
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Signs in; with two-factor authentication on, `code` is the code of the
	 * authenticator app or a recovery code (AccountServerError
	 * `code_required` without it, `wrong_code` with a wrong one).
	 */
	async login(
		server: string,
		username: string,
		password: string,
		code?: string,
	): Promise<AccountSession> {
		const result = await this.request(server, 'POST', '/account/login', {
			body: code ? { username, password, code } : { username, password },
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
	 * Asks the collaboration server about a project's links, for the
	 * signed-in account: `claim` makes the account its owner if it has none,
	 * and `reset` (owner only) replaces the editing link, cutting off the old
	 * one. Null when no account is signed in.
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
		const role =
			result?.role === 'owner' || MEMBER_ROLES.includes(result?.role)
				? (result.role as ProjectRole)
				: null;
		const links = {
			edit: this.validLink(result?.edit, 'edit'),
			review: this.validLink(result?.review, 'review'),
			view: this.validLink(result?.view, 'view'),
		};
		// A project opened through a review or read-only link moves to the
		// current one of its kind.
		const current = links[projectLinkKind(projectId)];
		if (current) await this.rememberEditLink(userId, projectId, current);
		return {
			owner,
			role,
			...links,
			...(Number.isInteger(result?.requests)
				? { requests: result.requests }
				: {}),
			...(REQUESTED_ROLES.includes(result?.requested)
				? { requested: result.requested as RequestedRole }
				: {}),
		};
	}

	/**
	 * Opens a project granted to the account, once its list has it under
	 * that link with its name (not as a project met by a link).
	 */
	async openGranted(link: string): Promise<void> {
		if (this.userId) await this.sync(this.userId).catch(() => {});
		window.location.hash = `yjs:${link}`;
	}

	/**
	 * Asks the project's owner for more access, as Overleaf's "Request
	 * access", or withdraws the request (`role` null): the role asked for,
	 * or null.
	 */
	async requestAccess(
		projectId: string,
		role: RequestedRole | null,
		name: string,
	): Promise<RequestedRole | null> {
		const userId = this.userId;
		const session = userId ? this.getSession(userId) : null;
		if (!userId || !session) throw new AccountServerError('signed_out', 401);
		const project = projectLinkService.serverId(projectId);
		const result = await this.request(
			session.server,
			'POST',
			'/share/request',
			{
				token: session.token,
				body: role ? { project, role, name } : { project, cancel: true },
			},
		);
		window.dispatchEvent(
			new CustomEvent(ACCESS_REQUESTS_CHANGED, { detail: { projectId } }),
		);
		return REQUESTED_ROLES.includes(result?.requested)
			? (result.requested as RequestedRole)
			: null;
	}

	/**
	 * The access requests waiting on a project, for its owner, after
	 * granting or declining one: granted, the account becomes a member with
	 * the role it asked for. Null without an account.
	 */
	async accessRequests(
		projectId: string,
		decision: {
			grant?: string;
			decline?: string;
			name?: string;
			type?: string;
		} = {},
	): Promise<AccessRequest[] | null> {
		const userId = this.userId;
		const session = userId ? this.getSession(userId) : null;
		if (!userId || !session) return null;
		const result = await this.request(
			session.server,
			'POST',
			'/share/members',
			{
				token: session.token,
				body: { project: projectLinkService.serverId(projectId), ...decision },
			},
		);
		if (decision.grant || decision.decline) {
			window.dispatchEvent(
				new CustomEvent(ACCESS_REQUESTS_CHANGED, { detail: { projectId } }),
			);
		}
		return Array.isArray(result?.requests)
			? result.requests.filter(
					(request: AccessRequest) =>
						typeof request?.username === 'string' &&
						REQUESTED_ROLES.includes(request.role),
				)
			: [];
	}

	/** Whether this device can ask the collaboration server for anything. */
	isLinked(): boolean {
		return !!this.userId && !!this.getSession(this.userId);
	}

	/**
	 * A copy of a project, as Overleaf's "Make a copy", made by the
	 * collaboration server: the id of the new project, which the account
	 * owns, or null when no account is signed in.
	 */
	async copyProject(projectId: string, name: string): Promise<string | null> {
		const userId = this.userId;
		const session = userId ? this.getSession(userId) : null;
		if (!userId || !session) return null;

		const result = await this.request(session.server, 'POST', '/share/copy', {
			token: session.token,
			body: { project: projectLinkService.serverId(projectId), name },
		});
		return typeof result?.project === 'string' &&
			projectLinkKind(result.project) === 'edit' &&
			isValidYjsProjectId(result.project)
			? result.project
			: null;
	}

	/**
	 * The collaboration server's download of a file from the web, as
	 * Overleaf's "From external URL", or null when no account is signed in.
	 */
	async fetchThroughServer(
		url: string,
		signal?: AbortSignal,
	): Promise<Response | null> {
		const userId = this.userId;
		const session = userId ? this.getSession(userId) : null;
		if (!userId || !session) return null;
		return fetch(`${session.server}/fetch`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${session.token}`,
			},
			body: JSON.stringify({ url }),
			signal,
		});
	}

	/**
	 * Has the collaboration server tell a comment's thread, by email, of the
	 * comment or the reply this account just wrote (server/collab/
	 * reviewNotices.js). Nothing without a signed-in account.
	 */
	async notifyReview(body: {
		project: string;
		comment: string;
		reply?: boolean;
		language?: string;
	}): Promise<void> {
		const userId = this.userId;
		const session = userId ? this.getSession(userId) : null;
		if (!userId || !session) return;
		await fetch(`${session.server}/review/notify`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${session.token}`,
			},
			body: JSON.stringify(body),
		});
	}

	/**
	 * Attaches a file to a GitHub release through the collaboration server,
	 * which GitHub's upload server takes and pages are not (CORS). The token
	 * passes through, unkept. Null when no account is signed in.
	 */
	async uploadReleaseAsset(
		input: {
			repositoryId: string;
			releaseId: number;
			name: string;
			type: string;
			bytes: Uint8Array;
			githubToken: string;
		},
		signal?: AbortSignal,
	): Promise<Response | null> {
		const userId = this.userId;
		const session = userId ? this.getSession(userId) : null;
		if (!userId || !session) return null;
		const query = new URLSearchParams({
			repository: input.repositoryId,
			release: String(input.releaseId),
			name: input.name,
		});
		return fetch(`${session.server}/github/release-asset?${query}`, {
			method: 'POST',
			headers: {
				'Content-Type': input.type,
				Authorization: `Bearer ${session.token}`,
				'X-GitHub-Token': input.githubToken,
			},
			body: input.bytes as Uint8Array<ArrayBuffer>,
			signal,
		});
	}

	/**
	 * The accounts the owner invited to a project, after adding or removing
	 * one. Removing someone replaces the link they used.
	 */
	async projectMembers(
		projectId: string,
		change: MembersChange = {},
	): Promise<ProjectMember[] | null> {
		const userId = this.userId;
		const session = userId ? this.getSession(userId) : null;
		if (!userId || !session) return null;

		const result = await this.request(
			session.server,
			'POST',
			'/share/members',
			{
				token: session.token,
				body: { project: projectLinkService.serverId(projectId), ...change },
			},
		);
		const edit = this.validLink(result?.edit, 'edit');
		if (edit) await this.rememberEditLink(userId, projectId, edit);
		// The project list tells who owns each project.
		if (change.transfer) this.projectChanged(userId);
		return Array.isArray(result?.members)
			? result.members.filter(
					(member: ProjectMember) =>
						typeof member?.username === 'string' &&
						MEMBER_ROLES.includes(member.role),
				)
			: [];
	}

	/**
	 * Who works on a project, for any of its members: its owner and the
	 * accounts invited. Null without an account, or from a server that shows
	 * them to the owner only.
	 */
	async projectPeople(projectId: string): Promise<ProjectPeople | null> {
		const userId = this.userId;
		const session = userId ? this.getSession(userId) : null;
		if (!userId || !session) return null;
		try {
			const result = await this.request(
				session.server,
				'POST',
				'/share/members',
				{
					token: session.token,
					body: { project: projectLinkService.serverId(projectId) },
				},
			);
			if (!Array.isArray(result?.members)) return null;
			return {
				...(typeof result.owner === 'string' ? { owner: result.owner } : {}),
				members: result.members.filter(
					(member: ProjectMember) =>
						typeof member?.username === 'string' &&
						MEMBER_ROLES.includes(member.role),
				),
				// From servers that tell who came by a link.
				visitors: Array.isArray(result.visitors)
					? result.visitors.filter(
							(visitor: ProjectVisitor) =>
								typeof visitor?.username === 'string' &&
								['edit', 'review', 'view'].includes(visitor.access),
						)
					: [],
			};
		} catch {
			return null;
		}
	}

	/**
	 * A project's personal invitations, as Overleaf's by email but sent by
	 * hand: made for a role, listed, or taken back. For its owner only.
	 */
	async projectInvites(
		projectId: string,
		change: {
			create?: { role: ProjectMember['role'] };
			revoke?: string;
			resend?: string;
			name?: string;
			type?: string;
			email?: string;
			/** Have the server mail it, in this language. */
			send?: boolean;
			language?: string;
		} = {},
	): Promise<ProjectInvites | null> {
		const userId = this.userId;
		const session = userId ? this.getSession(userId) : null;
		if (!userId || !session) return null;
		const result = await this.request(
			session.server,
			'POST',
			'/share/invites',
			{
				token: session.token,
				body: { project: projectLinkService.serverId(projectId), ...change },
				timeout:
					change.send || change.resend ? MAIL_TIMEOUT_MS : REQUEST_TIMEOUT_MS,
			},
		);
		const valid = (entry: ProjectInvite) =>
			typeof entry?.invite === 'string' && MEMBER_ROLES.includes(entry.role);
		const sends: InviteMailing | null = ['yes', 'unconfirmed', 'no'].includes(
			result?.sends,
		)
			? result.sends
			: null;
		return {
			...(valid(result?.invite) ? { invite: result.invite } : {}),
			invites: Array.isArray(result?.invites)
				? result.invites.filter(valid)
				: [],
			sends,
			...(result?.mailed === true ? { mailed: true } : {}),
			...(typeof result?.mailError === 'string'
				? { mailError: result.mailError }
				: {}),
		};
	}

	/**
	 * Where assistants such as Claude connect to work on this account's
	 * projects (server/collab/mcp.js); null without a server account.
	 */
	assistantConnectorUrl(): string | null {
		const userId = this.userId;
		const session = userId ? this.getSession(userId) : null;
		return session?.server ? `${session.server.replace(/\/+$/, '')}/mcp` : null;
	}

	/**
	 * The applications this account lets work on its projects, after
	 * disconnecting `revoke` if given; null without a server account.
	 */
	async assistantConnections(
		revoke?: string,
	): Promise<AssistantConnection[] | null> {
		const userId = this.userId;
		const session = userId ? this.getSession(userId) : null;
		if (!userId || !session) return null;
		const result = await this.request(
			session.server,
			revoke ? 'POST' : 'GET',
			'/oauth/connections',
			{ token: session.token, ...(revoke ? { body: { revoke } } : {}) },
		);
		return Array.isArray(result?.connections)
			? result.connections.filter(
					(entry: AssistantConnection) =>
						typeof entry?.id === 'string' && typeof entry.name === 'string',
				)
			: [];
	}

	/**
	 * The devices signed in to the account, this one first; signing out
	 * another (`revoke`), or all the others. Null without a server account.
	 */
	async accountDevices(
		change?: { revoke: string } | { others: true },
	): Promise<AccountDevice[] | null> {
		const userId = this.userId;
		const session = userId ? this.getSession(userId) : null;
		if (!userId || !session) return null;
		const result = await this.request(
			session.server,
			change ? 'POST' : 'GET',
			'/account/sessions',
			{ token: session.token, ...(change ? { body: change } : {}) },
		);
		return Array.isArray(result?.sessions)
			? result.sessions.filter(
					(entry: AccountDevice) =>
						typeof entry?.id === 'string' &&
						typeof entry.lastUsedAt === 'number',
				)
			: [];
	}

	/**
	 * Whether the signed-in account administers the server (its
	 * ADMIN_ACCOUNTS), asked once per session; false when the server cannot
	 * say.
	 */
	async isAdmin(): Promise<boolean> {
		const userId = this.userId;
		const session = userId ? this.getSession(userId) : null;
		if (!session) return false;
		if (this.adminCheck?.token !== session.token) {
			const admin = this.request(session.server, 'GET', '/admin', {
				token: session.token,
			}).then(
				(result) => result?.admin === true,
				() => {
					// Asked again next time, the server being back.
					if (this.adminCheck?.admin === admin) this.adminCheck = null;
					return false;
				},
			);
			this.adminCheck = { token: session.token, admin };
		}
		return this.adminCheck.admin;
	}

	/** The administration page: the server's state and every account. */
	async adminOverview(): Promise<AdminOverview> {
		const userId = this.userId;
		const session = userId ? this.getSession(userId) : null;
		if (!session) throw new AccountServerError('signed_out', 401);
		const result = await this.request(
			session.server,
			'GET',
			'/admin/overview',
			{ token: session.token },
		);
		return {
			...result,
			accounts: Array.isArray(result?.accounts)
				? result.accounts.filter(
						(entry: AdminAccount) =>
							typeof entry?.id === 'string' &&
							typeof entry.username === 'string',
					)
				: [],
			orphans: Array.isArray(result?.orphans)
				? result.orphans.filter(
						(entry: AdminOrphan) =>
							typeof entry?.key === 'string' &&
							ORPHAN_REASONS.includes(entry.reason),
					)
				: [],
		};
	}

	/**
	 * Deletes orphan projects for good from the administration page, by
	 * their keys; those no longer orphans are skipped.
	 */
	async adminDeleteProjects(
		keys: string[],
	): Promise<{ deleted: number; skipped: number }> {
		const userId = this.userId;
		const session = userId ? this.getSession(userId) : null;
		if (!session) throw new AccountServerError('signed_out', 401);
		const result = await this.request(
			session.server,
			'POST',
			'/admin/delete-projects',
			{ token: session.token, body: { projects: keys } },
		);
		return {
			deleted: Number(result?.deleted) || 0,
			skipped: Number(result?.skipped) || 0,
		};
	}

	/**
	 * Deletes an account from the administration page, with the projects it
	 * owns, if it still has this name.
	 */
	/** Who may create an account, and the links to create one still good. */
	async adminSignUpLinks(): Promise<AdminSignUpLinks> {
		const session = this.userId ? this.getSession(this.userId) : null;
		if (!session) throw new AccountServerError('signed_out', 401);
		const result = await this.request(
			session.server,
			'GET',
			'/admin/sign-up-links',
			{ token: session.token },
		);
		return {
			mode: result?.mode === 'invitation' ? 'invitation' : 'open',
			domains: Array.isArray(result?.domains) ? result.domains : [],
			links: Array.isArray(result?.links) ? result.links : [],
		};
	}

	/**
	 * A new link to create an account (its token, shown once), or, with
	 * `revoke`, one taken back; the links still good either way.
	 */
	async adminChangeSignUpLinks(
		revoke?: string,
	): Promise<{ token?: string; expiresAt?: number; links: AdminSignUpLink[] }> {
		const session = this.userId ? this.getSession(this.userId) : null;
		if (!session) throw new AccountServerError('signed_out', 401);
		const result = await this.request(
			session.server,
			'POST',
			'/admin/sign-up-links',
			{ token: session.token, body: revoke ? { revoke } : {} },
		);
		return {
			...(typeof result?.token === 'string'
				? { token: result.token, expiresAt: result.expiresAt }
				: {}),
			links: Array.isArray(result?.links) ? result.links : [],
		};
	}

	async adminDeleteAccount(id: string, username: string): Promise<void> {
		const userId = this.userId;
		const session = userId ? this.getSession(userId) : null;
		if (!session) throw new AccountServerError('signed_out', 401);
		await this.request(session.server, 'POST', '/admin/delete', {
			token: session.token,
			body: { account: id, username },
		});
	}

	/**
	 * How many recovery codes the account has left, and when they were made.
	 * Null when no account is signed in on the server.
	 */
	async recoveryStatus(): Promise<{
		count: number;
		createdAt?: number;
	} | null> {
		const userId = this.userId;
		const session = userId ? this.getSession(userId) : null;
		if (!userId || !session) return null;
		const result = await this.request(
			session.server,
			'GET',
			'/account/recovery',
			{ token: session.token },
		);
		return {
			count: typeof result?.count === 'number' ? result.count : 0,
			...(typeof result?.createdAt === 'number'
				? { createdAt: result.createdAt }
				: {}),
		};
	}

	/**
	 * New recovery codes for the account, replacing those it had, as
	 * GitHub's: the server shows them only now and keeps their hashes.
	 */
	/**
	 * The address Git clones a project from (server/collab/git.js), with the
	 * account's name; null without a server account.
	 */
	gitCloneUrl(projectId: string): string | null {
		const userId = this.userId;
		const session = userId ? this.getSession(userId) : null;
		if (!session?.server) return null;
		const url = new URL(
			`${session.server.replace(/\/+$/, '')}/git/${projectLinkService.serverId(projectId)}`,
		);
		url.username = encodeURIComponent(session.username);
		return url.toString();
	}

	/** The account's Git tokens; null without a server account. */
	async gitTokens(): Promise<GitToken[] | null> {
		const userId = this.userId;
		const session = userId ? this.getSession(userId) : null;
		if (!session) return null;
		return gitTokensOf(
			await this.request(session.server, 'GET', '/account/git-tokens', {
				token: session.token,
			}),
		);
	}

	/** A new Git token, shown only now, and the tokens there are. */
	async createGitToken(
		password: string,
		label: string,
	): Promise<{ token: string; tokens: GitToken[] }> {
		const userId = this.userId;
		const session = userId ? this.getSession(userId) : null;
		if (!session) throw new AccountServerError('signed_out', 401);
		const result = await this.request(
			session.server,
			'POST',
			'/account/git-tokens',
			{ token: session.token, body: { password, label } },
		);
		return { token: String(result?.token ?? ''), tokens: gitTokensOf(result) };
	}

	/** Takes a Git token back: Git can no longer use it. */
	async revokeGitToken(id: string): Promise<GitToken[]> {
		const userId = this.userId;
		const session = userId ? this.getSession(userId) : null;
		if (!session) throw new AccountServerError('signed_out', 401);
		return gitTokensOf(
			await this.request(session.server, 'POST', '/account/git-tokens', {
				token: session.token,
				body: { revoke: id },
			}),
		);
	}

	async createRecoveryCodes(
		password: string,
	): Promise<{ codes: string[]; createdAt: number } | null> {
		const userId = this.userId;
		const session = userId ? this.getSession(userId) : null;
		if (!userId || !session) return null;
		const result = await this.request(
			session.server,
			'POST',
			'/account/recovery',
			{ token: session.token, body: { password } },
		);
		return {
			codes: Array.isArray(result?.codes)
				? result.codes.filter((code: unknown) => typeof code === 'string')
				: [],
			createdAt: Number(result?.createdAt) || Date.now(),
		};
	}

	/**
	 * A forgotten password: a recovery code, used up, sets a new one on the
	 * server, and every device signs in again.
	 */
	async recover(
		username: string,
		code: string,
		newPassword: string,
	): Promise<{ username: string; remaining: number }> {
		const result = await this.request(
			this.serverFor(),
			'POST',
			'/account/recover',
			{
				body: { username, code, newPassword },
			},
		);
		return {
			username: String(result?.username ?? username),
			remaining: Number(result?.remaining) || 0,
		};
	}

	/** Whether the server recovers accounts by email (it sends mail). */
	async recoveryOptions(): Promise<{ email: boolean }> {
		try {
			const result = await this.request(
				this.serverFor(),
				'GET',
				'/account/recovery/options',
			);
			return { email: result?.email === true };
		} catch {
			return { email: false };
		}
	}

	/**
	 * The address the account may be recovered with, and one waiting to be
	 * confirmed. Null when no account is signed in on the server.
	 */
	async recoveryEmail(): Promise<RecoveryEmailStatus | null> {
		const userId = this.userId;
		const session = userId ? this.getSession(userId) : null;
		if (!userId || !session) return null;
		const result = await this.request(session.server, 'GET', '/account/email', {
			token: session.token,
		});
		return recoveryEmailStatus(result);
	}

	/**
	 * Gives the account an address to be recovered with, which the server
	 * mails a link to confirm; or, with null, takes it away.
	 */
	async setRecoveryEmail(
		address: string | null,
		password: string,
		language: string,
	): Promise<RecoveryEmailStatus | null> {
		const userId = this.userId;
		const session = userId ? this.getSession(userId) : null;
		if (!userId || !session) return null;
		const result = await this.request(
			session.server,
			'POST',
			'/account/email',
			{
				token: session.token,
				body:
					address === null
						? { password, remove: true }
						: { password, address, language },
				timeout: address === null ? REQUEST_TIMEOUT_MS : MAIL_TIMEOUT_MS,
			},
		);
		return recoveryEmailStatus(result);
	}

	/**
	 * The address given when signing up, which becomes the account's once
	 * the link mailed to it confirms it, as on Overleaf; null when the
	 * server sends no mail.
	 */
	async confirmSignUpEmail(
		address: string,
		password: string,
		language: string,
	): Promise<RecoveryEmailStatus | null> {
		if (!(await this.recoveryOptions()).email) return null;
		return this.setRecoveryEmail(address, password, language);
	}

	/** The link mailed to confirm a recovery address, on any device. */
	async confirmRecoveryEmail(token: string): Promise<string> {
		const result = await this.request(
			this.serverFor(),
			'POST',
			'/account/email/confirm',
			{ body: { token } },
		);
		return String(result?.address ?? '');
	}

	/**
	 * A forgotten password: the server mails a link to the account's
	 * recovery address, if the name or address is one it knows; it does not
	 * say whether it is.
	 */
	async forgotPassword(login: string, language: string): Promise<void> {
		await this.request(this.serverFor(), 'POST', '/account/forgot', {
			body: { login, language },
		});
	}

	/** The mailed link's new password; every device signs in again. */
	async resetPassword(
		token: string,
		newPassword: string,
	): Promise<{ username: string }> {
		const result = await this.request(
			this.serverFor(),
			'POST',
			'/account/reset',
			{
				body: { token, newPassword },
			},
		);
		return { username: String(result?.username ?? '') };
	}

	/**
	 * Leaves a project shared with the account, as Overleaf's "Leave": the
	 * account is no longer a member, and the project leaves its list on all
	 * its devices. False when no account is signed in on the server.
	 */
	async leaveProject(projectId: string): Promise<boolean> {
		const userId = this.userId;
		const session = userId ? this.getSession(userId) : null;
		if (!userId || !session) return false;
		await this.request(session.server, 'POST', '/share/leave', {
			token: session.token,
			body: { project: projectLinkService.serverId(projectId) },
		});
		return true;
	}

	/**
	 * Deletes a project for good on the collaboration server, as Overleaf
	 * does: its documents, files and versions are erased, for its
	 * collaborators too. Only its owner may. False when no account is signed
	 * in on the server.
	 */
	async deleteProjectForGood(projectId: string): Promise<boolean> {
		const userId = this.userId;
		const session = userId ? this.getSession(userId) : null;
		if (!userId || !session) return false;
		await this.request(session.server, 'POST', '/share/delete', {
			token: session.token,
			body: { project: projectLinkService.serverId(projectId) },
		});
		return true;
	}

	/** Joins the project an invitation is for; gives the link to open it. */
	async acceptInvite(invite: string): Promise<{
		project: string;
		role: ProjectMember['role'];
		name: string;
	}> {
		const userId = this.userId;
		const session = userId ? this.getSession(userId) : null;
		if (!userId || !session) throw new AccountServerError('signed_out', 401);
		const result = await this.request(session.server, 'POST', '/share/accept', {
			token: session.token,
			body: { invite },
		});
		if (
			typeof result?.project !== 'string' ||
			!isValidYjsProjectId(result.project) ||
			!MEMBER_ROLES.includes(result.role)
		) {
			throw new AccountServerError('invalid_response');
		}
		return {
			project: result.project,
			role: result.role,
			name: typeof result.name === 'string' ? result.name : '',
		};
	}

	private validLink(value: unknown, kind: ProjectLinkKind): string | undefined {
		return typeof value === 'string' &&
			isValidYjsProjectId(value) &&
			projectLinkKind(value) === kind
			? value
			: undefined;
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
				await this.syncPreferences(session, userId);
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

	/**
	 * Whether the account's server checks grammar (server/collab/grammar.js):
	 * asked once a quarter of an hour; false without a session.
	 */
	async grammarEnabled(userId: string): Promise<boolean> {
		const session = this.getSession(userId);
		if (!session) return false;
		const known = this.grammarAvailability;
		if (
			known?.server === session.server &&
			Date.now() - known.at < 15 * 60_000
		) {
			return known.enabled;
		}
		const enabled = await this.request(session.server, 'GET', '/grammar')
			.then((result) => result?.enabled === true)
			.catch(() => false);
		this.grammarAvailability = {
			server: session.server,
			at: Date.now(),
			enabled,
		};
		return enabled;
	}

	/** What LanguageTool finds in a paragraph, as annotated text. */
	async checkGrammar(
		userId: string,
		check: {
			language: string;
			annotation: AnnotationPart[];
			disabledRules?: string[];
		},
	): Promise<GrammarMatch[]> {
		const session = this.getSession(userId);
		if (!session) throw new AccountServerError('signed_out', 401);
		const { matches } = await this.request(
			session.server,
			'POST',
			'/grammar/check',
			{ token: session.token, body: check, timeout: 60_000 },
		);
		return Array.isArray(matches) ? (matches as GrammarMatch[]) : [];
	}

	private async syncPreferences(
		session: AccountSession,
		userId: string,
	): Promise<void> {
		if (!this.preferences) return;
		try {
			const sent = await this.preferences.entries(userId);
			const { entries } = await this.request(
				session.server,
				'POST',
				'/account/preferences',
				{ token: session.token, body: { entries: sent } },
			);
			if (Array.isArray(entries)) {
				await this.preferences.merge(userId, sent, entries);
			}
		} catch (error) {
			// A server without preferences still keeps the projects in step.
			if (error instanceof AccountServerError && error.status === 404) {
				moduleLog.info('The account server keeps no preferences');
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
		{
			token,
			body,
			timeout = REQUEST_TIMEOUT_MS,
		}: { token?: string; body?: unknown; timeout?: number } = {},
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
				signal: AbortSignal.timeout(timeout),
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
