// src/services/CompileOutputStore.ts
// The last outputs of a project's compiles, kept in this browser, so that
// a PDF shows again when the project is opened, as on Overleaf, rather than
// "No output available". One per compiler and main document, as a Markdown
// file open compiles itself beside the LaTeX document: each shows its own
// PDF when it is open again. In the project's own database
// (texlyre-project-<id>-output), which goes when the project is deleted.
import { type IDBPDatabase, openDB } from 'idb';

import { createNamedLogger } from '@/logging';

const moduleLog = createNamedLogger('CompileOutputStore');

const STORE = 'documents';
// Version 1's, one output per compiler.
const OLD_STORE = 'outputs';
// The newest kept, of all documents: a PDF each, which may be large.
const MAX_KEPT = 8;

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
	const db = await openDB(`texlyre-project-${projectKey}-output`, 2, {
		async upgrade(database, _oldVersion, _newVersion, transaction) {
			if (!database.objectStoreNames.contains(STORE)) {
				database.createObjectStore(STORE, {
					keyPath: ['providerId', 'mainFile'],
				});
			}
			if (database.objectStoreNames.contains(OLD_STORE)) {
				// The output kept before stays, as its document's.
				const kept = (await transaction
					.objectStore(OLD_STORE)
					.getAll()) as StoredCompileOutput[];
				for (const entry of kept) {
					if (typeof entry?.mainFile === 'string') {
						await transaction.objectStore(STORE).put(entry);
					}
				}
				database.deleteObjectStore(OLD_STORE);
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
			await withDatabase(projectKey, async (db) => {
				await db.put(STORE, entry);
				const kept = (await db.getAll(STORE)) as StoredCompileOutput[];
				const old = kept
					.sort((a, b) => b.compiledAt - a.compiledAt)
					.slice(MAX_KEPT);
				for (const stale of old) {
					await db.delete(STORE, [stale.providerId, stale.mainFile]);
				}
			});
		} catch (error) {
			// A full disk only loses the copy: the PDF stays on screen.
			moduleLog.warn('Could not keep the compile output:', error);
		}
	}

	/**
	 * The newest output kept for the project, or that of some compilers, or
	 * of one main document.
	 */
	async latest(
		projectKey: string,
		providerIds?: string[],
		mainFile?: string,
	): Promise<StoredCompileOutput | null> {
		if (!projectKey) return null;
		try {
			const entries = (await withDatabase(projectKey, (db) =>
				db.getAll(STORE),
			)) as StoredCompileOutput[];
			const wanted = entries.filter(
				(entry) =>
					(!providerIds || providerIds.includes(entry.providerId)) &&
					(mainFile === undefined || entry.mainFile === mainFile),
			);
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
