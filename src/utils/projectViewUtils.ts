// src/utils/projectViewUtils.ts
import type { Project } from '../types/projects';

// The lists of Overleaf's project page: the projects in use, those one owns
// and those shared with one, then the archived ones and the trash.
export type ProjectView = 'all' | 'mine' | 'shared' | 'archived' | 'trash';

export const PROJECT_VIEWS: readonly ProjectView[] = [
	'all',
	'mine',
	'shared',
	'archived',
	'trash',
];

/** Owned by another account; a project nobody claimed yet counts as one's own. */
export const isSharedWithMe = (project: Project): boolean =>
	project.owner === 'other';

export function inProjectView(project: Project, view: ProjectView): boolean {
	if (view === 'trash') return !!project.trashedAt;
	if (project.trashedAt) return false;
	if (view === 'archived') return !!project.archived;
	if (project.archived) return false;
	if (view === 'mine') return !isSharedWithMe(project);
	if (view === 'shared') return isSharedWithMe(project);
	return true;
}
