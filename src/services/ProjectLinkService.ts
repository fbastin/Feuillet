// src/services/ProjectLinkService.ts
import { createNamedLogger } from '@/logging';

const moduleLog = createNamedLogger('ProjectLinkService');

const STORAGE_KEY = 'feuillet-project-links';

type LinkListener = (projectId: string, serverId: string) => void;
type CutOffListener = (projectId: string) => void;
// Asks the collaboration server for the link a project opens under now, for
// its owner: the new id, or null when this user cannot have it.
type Recovery = (projectId: string, serverId: string) => Promise<string | null>;

const readLinks = (): Record<string, string> => {
	try {
		const links = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
		return links && typeof links === 'object' ? links : {};
	} catch {
		return {};
	}
};

/**
 * Which id opens each project on the collaboration server. A project keeps,
 * on each device, the id it was created or opened with: its local copy is
 * stored under it. When its owner replaces its editing link, the server opens
 * it under the new id only, and cuts off whoever kept the old one; the
 * owner's devices then reach it under the new id.
 */
class ProjectLinkService {
	private links: Record<string, string> = readLinks();
	private listeners: Set<LinkListener> = new Set();
	private cutOff: Set<string> = new Set();
	private cutOffListeners: Set<CutOffListener> = new Set();
	private recovery: Recovery | null = null;
	private recovering: Map<string, Promise<void>> = new Map();

	constructor() {
		// Another tab of this browser moved a project to a new link.
		window.addEventListener('storage', (event) => {
			if (event.key !== STORAGE_KEY) return;
			const previous = this.links;
			this.links = readLinks();
			const projectIds = new Set([
				...Object.keys(previous),
				...Object.keys(this.links),
			]);
			for (const projectId of projectIds) {
				const serverId = this.serverId(projectId);
				if ((previous[projectId] ?? projectId) === serverId) continue;
				this.setCutOff(projectId, false);
				for (const listener of this.listeners) listener(projectId, serverId);
			}
		});
	}

	/** The id the server opens a project under. */
	serverId(projectId: string): string {
		return Object.hasOwn(this.links, projectId)
			? this.links[projectId]
			: projectId;
	}

	/** The local project a link opens on this device, if it has one. */
	localId(serverId: string): string {
		for (const [projectId, linked] of Object.entries(this.links)) {
			if (linked === serverId) return projectId;
		}
		return serverId;
	}

	/** A project URL (yjs:<id>&doc:…) as others open it: with the server id. */
	toServerUrl(url: string): string {
		const match = /^yjs:([^&]+)(.*)$/.exec(url);
		return match ? `yjs:${this.serverId(match[1])}${match[2]}` : url;
	}

	/** A project URL as this device stores the project: with its local id. */
	toLocalUrl(url: string): string {
		const match = /^yjs:([^&]+)(.*)$/.exec(url);
		return match ? `yjs:${this.localId(match[1])}${match[2]}` : url;
	}

	setServerId(projectId: string, serverId: string): void {
		if (this.serverId(projectId) === serverId) return;
		const links = { ...readLinks(), [projectId]: serverId };
		if (serverId === projectId) delete links[projectId];
		this.links = links;
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(this.links));
		} catch (error) {
			moduleLog.warn('Could not remember a project link:', error);
		}
		this.setCutOff(projectId, false);
		for (const listener of this.listeners) listener(projectId, serverId);
	}

	addListener(listener: LinkListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	isCutOff(projectId: string): boolean {
		return this.cutOff.has(projectId);
	}

	addCutOffListener(listener: CutOffListener): () => void {
		this.cutOffListeners.add(listener);
		return () => this.cutOffListeners.delete(listener);
	}

	setRecovery(recovery: Recovery | null): void {
		this.recovery = recovery;
	}

	/**
	 * The server closed a connection because the link it was opened through
	 * no longer opens the project. Its owner moves on to the current link;
	 * anyone else is cut off.
	 */
	reportRefused(projectId: string, serverId: string): void {
		if (serverId !== this.serverId(projectId)) return;
		if (this.recovering.has(projectId)) return;

		const run = (async () => {
			let current: string | null = null;
			try {
				current = (await this.recovery?.(projectId, serverId)) ?? null;
			} catch (error) {
				moduleLog.warn('Could not ask for the current project link:', error);
			}
			if (current && current !== serverId) {
				moduleLog.info('The project opens under a new link');
				this.setServerId(projectId, current);
			} else {
				this.setCutOff(projectId, true);
			}
		})().finally(() => this.recovering.delete(projectId));
		this.recovering.set(projectId, run);
	}

	private setCutOff(projectId: string, cutOff: boolean): void {
		if (this.cutOff.has(projectId) === cutOff) return;
		if (cutOff) this.cutOff.add(projectId);
		else this.cutOff.delete(projectId);
		for (const listener of this.cutOffListeners) listener(projectId);
	}
}

export const projectLinkService = new ProjectLinkService();
