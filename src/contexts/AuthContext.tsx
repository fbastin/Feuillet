// src/contexts/AuthContext.tsx
import type React from 'react';
import { type ReactNode, createContext, useEffect, useState } from 'react';

import { USER_PROFILE_SYNCED, authService } from '../services/AuthService';
import type {
	ProviderTicket,
	SignInProvider,
} from '../services/ExternalSignInService';
import type { AuthContextType, User } from '../types/auth';
import type {
	Project,
	ProjectCreateInput,
	ProjectGroup,
	ProjectType,
} from '../types/projects';

export const AuthContext = createContext<AuthContextType>({
	user: null,
	isAuthenticated: false,
	isInitializing: true,
	login: async () => {
		throw new Error('Not implemented');
	},
	loginWithProvider: async () => {
		throw new Error('Not implemented');
	},
	register: async () => {
		throw new Error('Not implemented');
	},
	createGuestAccount: async () => {
		throw new Error('Not implemented');
	},
	upgradeGuestAccount: async () => {
		throw new Error('Not implemented');
	},
	logout: async () => {
		throw new Error('Not implemented');
	},
	updateUser: async () => {
		throw new Error('Not implemented');
	},
	updateUserColor: async () => {
		throw new Error('Not implemented');
	},
	createProject: async () => {
		throw new Error('Not implemented');
	},
	updateProject: async () => {
		throw new Error('Not implemented');
	},
	deleteProject: async () => {
		throw new Error('Not implemented');
	},
	getProjectById: async () => {
		throw new Error('Not implemented');
	},
	getProjects: async () => {
		throw new Error('Not implemented');
	},
	getProjectsByTag: async () => {
		throw new Error('Not implemented');
	},
	getProjectsByGroup: async (group: ProjectGroup) => {
		throw new Error('Not implemented');
	},
	getProjectsByType: async (type: ProjectType) => {
		throw new Error('Not implemented');
	},
	searchProjects: async () => {
		throw new Error('Not implemented');
	},
	toggleFavorite: async () => {
		throw new Error('Not implemented');
	},
	verifyPassword: async () => {
		throw new Error('Not implemented');
	},
	updatePassword: async () => {
		throw new Error('Not implemented');
	},
	isGuestUser: () => false,
	cleanupExpiredGuests: async () => {
		throw new Error('Not implemented');
	},
});

interface AuthProviderProps {
	children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
	const [user, setUser] = useState<User | null>(null);
	const [isInitializing, setIsInitializing] = useState(true);

	useEffect(() => {
		const initAuth = async () => {
			await authService.initialize();
			setUser(authService.getCurrentUser());
			setIsInitializing(false);
		};

		initAuth();
	}, []);

	// The Git commit email or the color, changed on another device.
	useEffect(() => {
		const handleSynced = (event: Event) => {
			const synced = (event as CustomEvent<User>).detail;
			setUser((current) => (current?.id === synced?.id ? synced : current));
		};
		window.addEventListener(USER_PROFILE_SYNCED, handleSynced);
		return () => window.removeEventListener(USER_PROFILE_SYNCED, handleSynced);
	}, []);

	const login = async (
		username: string,
		password: string,
		code?: string,
	): Promise<User> => {
		const loggedInUser = await authService.login(username, password, code);
		setUser(loggedInUser);
		return loggedInUser;
	};

	const loginWithProvider = async (
		provider: SignInProvider,
		ticket: string,
		code?: string,
	): Promise<User | 'not-linked'> => {
		const result = await authService.loginWithProvider(provider, ticket, code);
		if (result !== 'not-linked') setUser(result);
		return result;
	};

	const register = async (
		username: string,
		password: string,
		email?: string,
		link?: ProviderTicket,
	): Promise<User> => {
		const newUser = await authService.register(username, password, email, link);
		setUser(newUser);
		return newUser;
	};

	const createGuestAccount = async (): Promise<User> => {
		const guestUser = await authService.createGuestAccount();
		setUser(guestUser);
		return guestUser;
	};

	const upgradeGuestAccount = async (
		username: string,
		password: string,
		email?: string,
	): Promise<User> => {
		const upgradedUser = await authService.upgradeGuestAccount(
			username,
			password,
			email,
		);
		setUser(upgradedUser);
		return upgradedUser;
	};

	const logout = async (): Promise<void> => {
		setUser(null);
		await authService.logout();
	};

	const updateUser = async (updatedUser: User): Promise<User> => {
		const result = await authService.updateUser(updatedUser);
		setUser(result);
		return result;
	};

	const updateUserColor = async (
		userId: string,
		color?: string,
		colorLight?: string,
	): Promise<User> => {
		const updatedUser = await authService.updateUserColor(
			userId,
			color,
			colorLight,
		);
		setUser(updatedUser);
		return updatedUser;
	};

	const createProject = async (
		projectData: ProjectCreateInput,
	): Promise<Project> => {
		return authService.createProject(projectData);
	};

	const updateProject = async (project: Project): Promise<Project> => {
		return authService.updateProject(project);
	};

	const deleteProject = async (id: string): Promise<void> => {
		return authService.deleteProject(id);
	};

	const getProjectById = async (id: string): Promise<Project | null> => {
		return authService.getProjectById(id);
	};

	const getProjects = async (): Promise<Project[]> => {
		return authService.getProjectsByUser();
	};

	const getProjectsByTag = async (tag: string): Promise<Project[]> => {
		return authService.getProjectsByTag(tag);
	};

	const getProjectsByType = async (type: ProjectType): Promise<Project[]> => {
		return authService.getProjectsByType(type);
	};

	const getProjectsByGroup = async (
		group: ProjectGroup,
	): Promise<Project[]> => {
		return authService.getProjectsByGroup(group);
	};

	const searchProjects = async (query: string): Promise<Project[]> => {
		return authService.searchProjects(query);
	};

	const toggleFavorite = async (projectId: string): Promise<Project> => {
		return authService.toggleFavorite(projectId);
	};

	const verifyPassword = async (
		userId: string,
		password: string,
	): Promise<boolean> => {
		return authService.verifyPassword(userId, password);
	};

	const updatePassword = async (
		userId: string,
		newPassword: string,
		currentPassword?: string,
	): Promise<User> => {
		const updatedUser = await authService.updatePassword(
			userId,
			newPassword,
			currentPassword,
		);
		setUser(updatedUser);
		return updatedUser;
	};

	const isGuestUser = (targetUser?: User | null): boolean => {
		return authService.isGuestUser(targetUser || user);
	};

	const cleanupExpiredGuests = async (): Promise<void> => {
		return authService.cleanupExpiredGuests();
	};

	return (
		<AuthContext.Provider
			value={{
				user,
				isAuthenticated: !!user,
				isInitializing,
				login,
				loginWithProvider,
				register,
				createGuestAccount,
				upgradeGuestAccount,
				logout,
				updateUser,
				updateUserColor,
				createProject,
				updateProject,
				deleteProject,
				getProjectById,
				getProjects,
				getProjectsByTag,
				getProjectsByType,
				getProjectsByGroup,
				searchProjects,
				toggleFavorite,
				verifyPassword,
				updatePassword,
				isGuestUser,
				cleanupExpiredGuests,
			}}
		>
			{children}
		</AuthContext.Provider>
	);
};
