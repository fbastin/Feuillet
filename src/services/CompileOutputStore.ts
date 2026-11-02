// src/services/CompileOutputStore.ts
// The last output of a project's compile, kept in this browser, so that its
// PDF shows again when the project is opened, as on Overleaf, rather than
// "No output available". One per compiler, in the project's own database
// (texlyre-project-<id>-output), which goes when the project is deleted.
import { type IDBPDatabase, openDB } from 'idb';

import { createNamedLogger } from '@/logging';

const moduleLog = createNamedLogger('CompileOutputStore');

const STORE = 'outputs';

export interface StoredCompileOutput {
	/** The compiler that made it: a typesetter id, or 'internal:latex'. */
	providerId: string;
	output: Uint8Array;
	mimeType: string;
	format: string;
	log: string;
	status: number;
	mainFile: string;
	synctex?: Uint8Array;
	compiledAt: number;
}

/** The project's id in its database names, from its document URL. */
export const projectKeyOf = (docUrl: string): string =>
	docUrl.startsWith('yjs:') ? docUrl.slice(4) : docUrl;

// Opened for each use and closed after, so that deleting the project's
// databases is never held up.
const withDatabase = async <T>(
	projectKey: string,
	use: (db: IDBPDatabase) => Promise<T>,
): Promise<T> => {
	const db = await openDB(`texlyre-project-${projectKey}-output`, 1, {
		upgrade(database) {
			if (!database.objectStoreNames.contains(STORE)) {
				database.createObjectStore(STORE, { keyPath: 'providerId' });
			}
		},
	});
	try {
		return await use(db);
	} finally {
		db.close();
	}
};

class CompileOutputStore {
	async save(projectKey: string, entry: StoredCompileOutput): Promise<void> {
		if (!projectKey) return;
		try {
			await withDatabase(projectKey, (db) => db.put(STORE, entry));
		} catch (error) {
			// A full disk only loses the copy: the PDF stays on screen.
			moduleLog.warn('Could not keep the compile output:', error);
		}
	}

	/** The newest output kept for the project, or that of some compilers. */
	async latest(
		projectKey: string,
		providerIds?: string[],
	): Promise<StoredCompileOutput | null> {
		if (!projectKey) return null;
		try {
			const entries = (await withDatabase(projectKey, (db) =>
				db.getAll(STORE),
			)) as StoredCompileOutput[];
			const wanted = providerIds
				? entries.filter((entry) => providerIds.includes(entry.providerId))
				: entries;
			return (
				wanted
					.filter((entry) => entry.output instanceof Uint8Array)
					.sort((a, b) => b.compiledAt - a.compiledAt)[0] ?? null
			);
		} catch (error) {
			moduleLog.warn('Could not read the kept compile output:', error);
			return null;
		}
	}
}

export const compileOutputStore = new CompileOutputStore();
