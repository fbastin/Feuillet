// src/types/auth.ts
import type {
	ProviderTicket,
	SignInProvider,
} from '../services/ExternalSignInService';
import type {
	Project,
	ProjectCreateInput,
	ProjectGroup,
	ProjectType,
} from './projects';

export interface AuthContextType {
	user: User | null;
	isAuthenticated: boolean;
	isInitializing: boolean;
	/** `code`: two-factor authentication's, once the server asks for it. */
	login: (username: string, password: string, code?: string) => Promise<User>;
	/**
	 * Signs in with Google or ORCID: 'not-linked' when no account is linked
	 * to that account.
	 */
	loginWithProvider: (
		provider: SignInProvider,
		ticket: string,
		code?: string,
	) => Promise<User | 'not-linked'>;
	register: (
		username: string,
		password: string,
		email?: string,
		/** Google's or ORCID's sign-in, to link the account to that account. */
		link?: ProviderTicket,
	) => Promise<User>;
	createGuestAccount: () => Promise<User>;
	upgradeGuestAccount: (
		username: string,
		password: string,
		email?: string,
	) => Promise<User>;
	logout: () => Promise<void>;
	updateUser: (user: User) => Promise<User>;
	updateUserColor: (
		userId: string,
		color?: string,
		colorLight?: string,
	) => Promise<User>;
	createProject: (project: ProjectCreateInput) => Promise<Project>;
	updateProject: (project: Project) => Promise<Project>;
	deleteProject: (id: string) => Promise<void>;
	getProjectById: (id: string) => Promise<Project | null>;
	getProjects: () => Promise<Project[]>;
	getProjectsByTag: (tag: string) => Promise<Project[]>;
	getProjectsByType: (type: ProjectType) => Promise<Project[]>;
	getProjectsByGroup: (type: ProjectGroup) => Promise<Project[]>;
	searchProjects: (query: string) => Promise<Project[]>;
	toggleFavorite: (projectId: string) => Promise<Project>;
	verifyPassword: (userId: string, password: string) => Promise<boolean>;
	updatePassword: (
		userId: string,
		newPassword: string,
		currentPassword?: string,
	) => Promise<User>;
	isGuestUser: (user?: User | null) => boolean;
	cleanupExpiredGuests: () => Promise<void>;
}

export interface User {
	id: string;
	username: string;
	name?: string;
	passwordHash: string;
	/**
	 * The account's address, as on Overleaf: once a link mailed to it
	 * confirms it, a forgotten password sends a link there. The server
	 * keeps it; this is the browser's copy.
	 */
	email?: string;
	/** The author address of the user's Git commits, kept apart. */
	gitEmail?: string;
	createdAt: number;
	lastLogin?: number;
	color?: string;
	colorLight?: string;
	/**
	 * Whether the account asks for a code at sign-in, as last known on this
	 * device: then signing in here waits for the server, never offline.
	 */
	twoFactor?: boolean;
	isGuest?: boolean;
	isChelysEnrolled?: boolean;
	sessionId?: string;
	expiresAt?: number;
}
