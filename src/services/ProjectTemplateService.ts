// src/services/ProjectTemplateService.ts
// The templates of the new-project form, bundled with the app: each file is
// its own chunk, fetched only when a project is made from its template.
import type { FileNode } from '../types/files';
import {
	type ProjectTemplateId,
	type TemplateEntry,
	type TemplateLanguage,
	type TemplateValues,
	createTemplateFiles,
} from '../utils/projectStarterUtils';

const ROOT = '../assets/templates/';

const TEXT_FILES = import.meta.glob<string>(
	'../assets/templates/*/*/**/*.{tex,bib}',
	{ query: '?raw', import: 'default' },
);
const BINARY_FILES = import.meta.glob<string>(
	'../assets/templates/*/*/**/*.{png,jpg,pdf}',
	{ query: '?url', import: 'default' },
);
const PREVIEWS = import.meta.glob<string>('../assets/template-previews/*.png', {
	query: '?url',
	import: 'default',
});

class ProjectTemplateService {
	/** The first page of each template, compiled, by template id. */
	async previewUrls(
		language: TemplateLanguage,
	): Promise<Partial<Record<ProjectTemplateId, string>>> {
		const urls: Partial<Record<ProjectTemplateId, string>> = {};
		await Promise.all(
			Object.entries(PREVIEWS).map(async ([key, load]) => {
				const match = /\/([a-z]+)-([a-z]+)\.png$/.exec(key);
				if (match?.[2] === language) {
					urls[match[1] as ProjectTemplateId] = await load();
				}
			}),
		);
		return urls;
	}

	async createFiles(
		id: ProjectTemplateId,
		language: TemplateLanguage,
		values: TemplateValues,
	): Promise<FileNode[]> {
		const folder = `${ROOT}${id}/${language}/`;
		const pathOf = (key: string) => key.slice(folder.length - 1);
		const entries: TemplateEntry[] = [];

		for (const [key, load] of Object.entries(TEXT_FILES)) {
			if (key.startsWith(folder)) {
				entries.push({ path: pathOf(key), content: await load() });
			}
		}
		for (const [key, load] of Object.entries(BINARY_FILES)) {
			if (!key.startsWith(folder)) continue;
			const response = await fetch(await load());
			if (!response.ok) {
				throw new Error(`Failed to load ${key}: ${response.statusText}`);
			}
			entries.push({
				path: pathOf(key),
				content: await response.arrayBuffer(),
			});
		}

		if (entries.length === 0) {
			throw new Error(`Unknown template: ${id} (${language})`);
		}
		return createTemplateFiles(entries, values);
	}
}

export const projectTemplateService = new ProjectTemplateService();
