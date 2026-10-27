// src/services/ProjectHistoryService.ts
import { t } from '@/i18n';
import { projectLinkService } from './ProjectLinkService';

export type VersionChangeType = 'added' | 'modified' | 'deleted';

export interface VersionChange {
	path: string;
	type: VersionChangeType;
}

export interface VersionSummary {
	id: string;
	time: number;
	authors: string[];
	changes: VersionChange[];
}

export interface VersionEntry {
	path: string;
	hash: string;
	size: number;
}

export interface ProjectVersion extends VersionSummary {
	// Documents edited together, with their text's checksum.
	docs: Array<VersionEntry & { id: string }>;
	// The project's other files.
	files: VersionEntry[];
}

const MAX_CACHED_CONTENTS = 200;

const fail = (): never => {
	throw new Error(t('Could not load the versions from the server.'));
};

/**
 * Reads the versions the collaboration server saves of each project, as on
 * Overleaf, and the contents they hold.
 */
class ProjectHistoryService {
	// Versions never change once saved.
	private versions: Map<string, ProjectVersion> = new Map();
	private contents: Map<string, ArrayBuffer> = new Map();

	private url(baseUrl: string, projectId: string, rest = ''): string {
		const serverId = encodeURIComponent(projectLinkService.serverId(projectId));
		return `${baseUrl}/history/${serverId}${rest}`;
	}

	async listVersions(
		baseUrl: string,
		projectId: string,
	): Promise<VersionSummary[]> {
		const response = await fetch(this.url(baseUrl, projectId)).catch(fail);
		if (!response?.ok) fail();
		const body = await response.json().catch(fail);
		return Array.isArray(body?.versions) ? body.versions : [];
	}

	async getVersion(
		baseUrl: string,
		projectId: string,
		versionId: string,
	): Promise<ProjectVersion> {
		const key = `${projectLinkService.serverId(projectId)}/${versionId}`;
		const known = this.versions.get(key);
		if (known) return known;
		const response = await fetch(
			this.url(baseUrl, projectId, `/${encodeURIComponent(versionId)}`),
		).catch(fail);
		if (!response?.ok) fail();
		const version = (await response.json().catch(fail)) as ProjectVersion;
		const loaded = {
			...version,
			docs: Array.isArray(version?.docs) ? version.docs : [],
			files: Array.isArray(version?.files) ? version.files : [],
		};
		this.versions.set(key, loaded);
		return loaded;
	}

	/** A document's text or a file's bytes, by checksum. */
	async getContent(
		baseUrl: string,
		projectId: string,
		hash: string,
	): Promise<ArrayBuffer> {
		const known = this.contents.get(hash);
		if (known) return known;
		const serverId = encodeURIComponent(projectLinkService.serverId(projectId));
		const response = await fetch(`${baseUrl}/files/${serverId}/${hash}`).catch(
			fail,
		);
		if (!response?.ok) fail();
		const content = await response.arrayBuffer();
		if (this.contents.size >= MAX_CACHED_CONTENTS) this.contents.clear();
		this.contents.set(hash, content);
		return content;
	}

	async getText(
		baseUrl: string,
		projectId: string,
		hash: string,
	): Promise<string> {
		return new TextDecoder().decode(
			await this.getContent(baseUrl, projectId, hash),
		);
	}
}

export const projectHistoryService = new ProjectHistoryService();
