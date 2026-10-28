// src/types/projects.ts
export type ProjectType = 'latex' | 'typst' | (string & {});
export type ProjectGroup = 'tex' | (string & {});

export interface Project {
	id: string;
	name: string;
	description: string;
	type: ProjectType;
	group?: ProjectGroup;
	compilerId?: string;
	docUrl: string;
	createdAt: number;
	updatedAt: number;
	ownerId: string;
	tags: string[];
	isFavorite: boolean;
	collaboratorIds?: string[];
	lastOpenedDocId?: string;
	lastOpenedFilePath?: string;
	isDiskLinked?: boolean;
	// The id the collaboration server opens the project under, once its owner
	// replaced its editing link.
	editId?: string;
	// When the fields an account lists (name, tags…) last changed; opening a
	// file updates updatedAt without changing them.
	accountUpdatedAt?: number;
	// Out of the main list, as on Overleaf: archived, or in the trash since.
	archived?: boolean;
	trashedAt?: number;
	// Who owns it on the collaboration server, as its account list says.
	owner?: 'you' | 'other' | 'none';
	ownerName?: string;
}

export type ProjectCreateInput = Omit<
	Project,
	'id' | 'createdAt' | 'updatedAt' | 'ownerId' | 'docUrl'
> & {
	docUrl?: string;
};

export interface TemplateVersion {
	version: string;
	downloadUrl: string;
	previewImage?: string;
	lastUpdated: string;
	compile?: string;
	file?: string;
}

export interface TemplateProject {
	id: string;
	name: string;
	description: string;
	category: string;
	tags: string[];
	downloadUrl: string;
	previewImage?: string;
	author?: string;
	version?: string;
	lastUpdated: string;
	type?: ProjectType;
	group?: ProjectGroup;
	compile?: string;
	file?: string;
	versions?: TemplateVersion[];
}
