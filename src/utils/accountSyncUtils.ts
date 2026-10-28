// src/utils/accountSyncUtils.ts
import type { Project } from '../types/projects';
import { collabHttpBaseUrl } from './serverFileSyncUtils';
import { getForcedUserData, getUserData } from './userDataUtils';

// A project as an account lists it on the server: what describes it, not
// what each device remembers about it (last opened file, disk links).
export interface AccountProject {
	id: string;
	docUrl?: string;
	editId?: string;
	name?: string;
	description?: string;
	type?: string;
	group?: string;
	compilerId?: string;
	tags?: string[];
	isFavorite?: boolean;
	archived?: boolean;
	trashedAt?: number;
	createdAt?: number;
	updatedAt: number;
	deleted?: boolean;
	// Told by the server with each list, never sent to it.
	owner?: Project['owner'];
	ownerName?: string;
}

export interface AccountSyncPlan {
	create: Project[];
	update: Project[];
	remove: Project[];
}

const ACCOUNT_FIELDS = [
	'docUrl',
	'editId',
	'name',
	'description',
	'type',
	'group',
	'compilerId',
	'tags',
	'isFavorite',
	'archived',
	'trashedAt',
] as const;

export const accountUpdatedAt = (project: Project): number =>
	project.accountUpdatedAt ?? project.updatedAt;

export function accountFieldsChanged(before: Project, after: Project): boolean {
	return ACCOUNT_FIELDS.some(
		(field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]),
	);
}

export function toAccountProject(project: Project): AccountProject {
	return {
		id: project.id,
		docUrl: project.docUrl,
		editId: project.editId,
		name: project.name,
		description: project.description,
		type: project.type,
		group: project.group,
		compilerId: project.compilerId,
		tags: project.tags ?? [],
		isFavorite: project.isFavorite,
		archived: project.archived ?? false,
		trashedAt: project.trashedAt,
		createdAt: project.createdAt,
		updatedAt: accountUpdatedAt(project),
	};
}

const describedBy = (entry: AccountProject) => ({
	docUrl: entry.docUrl || `yjs:${entry.id}`,
	editId: entry.editId,
	name: entry.name ?? '',
	description: entry.description ?? '',
	type: entry.type ?? 'latex',
	group: entry.group,
	compilerId: entry.compilerId,
	tags: entry.tags ?? [],
	isFavorite: entry.isFavorite ?? false,
	archived: entry.archived ?? false,
	trashedAt: entry.trashedAt,
	accountUpdatedAt: entry.updatedAt,
});

const ownedBy = (entry: AccountProject) => ({
	owner: entry.owner,
	ownerName: entry.ownerName,
});

// Brings this device in line with the account's list: the most recent
// version of each project wins, and a project deleted on another device is
// removed here unless it changed here since.
export function planAccountSync(
	local: Project[],
	remote: AccountProject[],
	ownerId: string,
): AccountSyncPlan {
	const localById = new Map(local.map((project) => [project.id, project]));
	const plan: AccountSyncPlan = { create: [], update: [], remove: [] };

	for (const entry of remote) {
		const current = localById.get(entry.id);

		if (entry.deleted) {
			if (current && accountUpdatedAt(current) <= entry.updatedAt) {
				plan.remove.push(current);
			}
			continue;
		}

		if (!current) {
			plan.create.push({
				...describedBy(entry),
				...ownedBy(entry),
				id: entry.id,
				ownerId,
				createdAt: entry.createdAt ?? entry.updatedAt,
				updatedAt: entry.updatedAt,
			});
		} else if (entry.updatedAt > accountUpdatedAt(current)) {
			plan.update.push({
				...current,
				...describedBy(entry),
				...ownedBy(entry),
				updatedAt: Math.max(current.updatedAt, entry.updatedAt),
			});
		} else if (
			entry.owner &&
			(entry.owner !== current.owner || entry.ownerName !== current.ownerName)
		) {
			// Who owns it is the server's to say, whichever list is newer.
			plan.update.push({ ...current, ...ownedBy(entry) });
		}
	}

	return plan;
}

// The account server is the collaboration server, so it follows the user's
// WebSocket server setting, or the site's defaults (texlyre-settings, written
// from userdata.json at startup) before anyone signs in.
export function getAccountServerUrl(userId?: string | null): string {
	const configured = (settings: Record<string, unknown> | null | undefined) =>
		typeof settings?.['collab-websocket-server'] === 'string'
			? (settings['collab-websocket-server'] as string)
			: '';

	const read = (load: () => Record<string, unknown> | null | undefined) => {
		try {
			return configured(load());
		} catch {
			return '';
		}
	};
	const server =
		(userId ? read(() => getUserData(userId, 'settings')) : '') ||
		read(() =>
			JSON.parse(localStorage.getItem('texlyre-settings') ?? 'null'),
		) ||
		read(() => getForcedUserData()?.settings);

	return /^wss?:\/\//i.test(server.trim()) ? collabHttpBaseUrl(server) : '';
}
