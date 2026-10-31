// src/hooks/useProjectCompileSettings.ts
// The main document and the compiler of the open project, kept with the
// project as on Overleaf: the same for every collaborator on every device,
// and kept by a copy of the project. Only editors change them.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WebsocketProvider } from 'y-websocket';

import { fileStoreService } from '../services/FileStoreService';
import type {
	TypesetterProvider,
	TypesetterUIField,
} from '../types/compilation';
import type { DocumentList, ProjectMetadata } from '../types/documents';
import {
	FILE_MOVED_EVENT,
	type FileMovedDetail,
	movedPath,
} from '../utils/fileEvents';
import {
	sharedFieldValue,
	withMainFile,
	withSharedFieldValue,
} from '../utils/projectCompileSettings';
import { useCollab } from './useCollab';
import { useProperties } from './useProperties';

type FieldValue = string | number | boolean;

/** Where each browser kept these settings before they were the project's. */
export const localMainFilePropertyId = (providerId: string) =>
	`external-${providerId}-main-file`;
const localFieldPropertyId = (providerId: string, key: string) =>
	`external-${providerId}-${key}`;

const sharedFieldsOf = (provider: TypesetterProvider): TypesetterUIField[] => {
	const fields = new Map<string, TypesetterUIField>();
	for (const field of [
		...(provider.ui?.compile?.fields ?? []),
		...(provider.ui?.export?.fields ?? []),
	]) {
		if (field.shared && !fields.has(field.key)) fields.set(field.key, field);
	}
	return [...fields.values()];
};

/**
 * @param manage The one place that moves the main document along when it is
 * renamed, and brings settings chosen in this browser into the project.
 */
export function useProjectCompileSettings(
	provider: TypesetterProvider,
	{ manage = false }: { manage?: boolean } = {},
) {
	const {
		doc,
		data,
		provider: connection,
		readOnly,
	} = useCollab<DocumentList>();
	const { getProperty, setProperty } = useProperties();
	const projectId = fileStoreService.getCurrentProjectId() || undefined;
	const metadata = data?.projectMetadata;
	const loaded = data !== undefined && data !== null;
	const canEdit = Boolean(doc) && !readOnly;

	const sharedFields = useMemo(() => sharedFieldsOf(provider), [provider]);
	const sharedField = useCallback(
		(key: string) => sharedFields.find((field) => field.key === key),
		[sharedFields],
	);

	const update = useCallback(
		(change: (current: ProjectMetadata) => ProjectMetadata) => {
			if (!doc || readOnly) return;
			const map = doc.getMap('data');
			doc.transact(() => {
				const stored = map.get('projectMetadata') as
					| ProjectMetadata
					| undefined;
				const current: ProjectMetadata = stored
					? JSON.parse(JSON.stringify(stored))
					: { name: '', description: '' };
				const next = change(current);
				if (JSON.stringify(next) !== JSON.stringify(current)) {
					map.set('projectMetadata', next);
				}
			});
		},
		[doc, readOnly],
	);

	const setMainFile = useCallback(
		(path: string | undefined) =>
			update((current) => withMainFile(current, path)),
		[update],
	);

	const isShared = useCallback(
		(key: string) => sharedField(key) !== undefined,
		[sharedField],
	);

	const readShared = useCallback(
		(key: string): FieldValue | undefined => {
			const field = sharedField(key);
			return field ? sharedFieldValue(metadata, provider.id, field) : undefined;
		},
		[sharedField, metadata, provider.id],
	);

	const writeShared = useCallback(
		(key: string, value: FieldValue | undefined) =>
			update((current) =>
				withSharedFieldValue(current, provider.id, key, value),
			),
		[update, provider.id],
	);

	// The main document keeps being the main document when it is renamed or
	// moved, as on Overleaf.
	useEffect(() => {
		if (!manage || !canEdit) return;
		const onMoved = (event: Event) => {
			const { from, to } = (event as CustomEvent<FileMovedDetail>).detail;
			update((current) => {
				const next = movedPath(current.mainFile, from, to);
				return next ? withMainFile(current, next) : current;
			});
		};
		document.addEventListener(FILE_MOVED_EVENT, onMoved);
		return () => document.removeEventListener(FILE_MOVED_EVENT, onMoved);
	}, [manage, canEdit, update]);

	// Only once the project has caught up with the collaboration server, so
	// that a newer project setting is not taken for a missing one.
	const [caughtUp, setCaughtUp] = useState(false);
	useEffect(() => {
		const websocket = connection as WebsocketProvider | undefined;
		if (!websocket || !('wsconnected' in websocket) || websocket.synced) {
			setCaughtUp(true);
			return;
		}
		setCaughtUp(false);
		const onSync = (synced: boolean) => {
			if (synced) setCaughtUp(true);
		};
		websocket.on('sync', onSync);
		return () => websocket.off('sync', onSync);
	}, [connection]);

	// What this browser chose before becomes the project's, where the project
	// has nothing yet; then this browser forgets it.
	const broughtIn = useRef<string | null>(null);
	useEffect(() => {
		if (!manage || !caughtUp || !canEdit || !loaded || !projectId) return;
		if (broughtIn.current === projectId) return;
		broughtIn.current = projectId;

		const scope = { scope: 'project' as const, projectId };
		const mainId = localMainFilePropertyId(provider.id);
		const localMain = getProperty(mainId, scope);
		const localValues = sharedFields.flatMap((field) => {
			const id = localFieldPropertyId(provider.id, field.key);
			const value = getProperty(id, scope);
			return value === undefined || value === null
				? []
				: [{ field, id, value: value as FieldValue }];
		});
		if (localMain === undefined && localValues.length === 0) return;

		update((current) => {
			let next = current;
			if (!next.mainFile && typeof localMain === 'string' && localMain) {
				next = withMainFile(next, localMain);
			}
			for (const { field, value } of localValues) {
				if (sharedFieldValue(next, provider.id, field) !== undefined) continue;
				const candidate = withSharedFieldValue(
					next,
					provider.id,
					field.key,
					value,
				);
				if (sharedFieldValue(candidate, provider.id, field) !== undefined) {
					next = candidate;
				}
			}
			return next;
		});
		if (localMain !== undefined) setProperty(mainId, undefined, scope);
		for (const { id } of localValues) setProperty(id, undefined, scope);
	}, [
		manage,
		caughtUp,
		canEdit,
		loaded,
		projectId,
		provider.id,
		sharedFields,
		getProperty,
		setProperty,
		update,
	]);

	const mainFile = metadata?.mainFile;
	return useMemo(
		() => ({
			/** The project's main document, if one was chosen. */
			mainFile,
			setMainFile,
			isShared,
			readShared,
			writeShared,
			canEdit,
		}),
		[mainFile, setMainFile, isShared, readShared, writeShared, canEdit],
	);
}
