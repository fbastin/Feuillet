// src/hooks/useBrowserCompilerMigration.ts
// Moves the open project from the browser compiler to TeX Live, once, if it
// has had the browser compiler since before TeX Live (see
// utils/browserCompilerMigration). An editor's client does it, once the
// project has caught up with the collaboration server, so that a choice made
// since is not taken for an old one.
import { useEffect, useState } from 'react';

import { fileStoreService } from '../services/FileStoreService';
import { typesetterRegistryService } from '../services/TypesetterRegistryService';
import type { DocumentList, ProjectMetadata } from '../types/documents';
import {
	movedToTexlive,
	needsTexliveMove,
} from '../utils/browserCompilerMigration';
import { TEXLIVE_TYPESETTER_ID } from '../utils/texliveTypesetter';
import { useCaughtUp } from './useCaughtUp';
import { useCollab } from './useCollab';
import { useProperties } from './useProperties';

const texliveOffered = () =>
	typesetterRegistryService.get(TEXLIVE_TYPESETTER_ID) !== undefined;

export function useBrowserCompilerMigration(): void {
	const { doc, data, provider, readOnly } = useCollab<DocumentList>();
	const { getProperty, setProperty } = useProperties();
	const caughtUp = useCaughtUp(provider);
	const [texlive, setTexlive] = useState(texliveOffered);
	useEffect(
		() =>
			typesetterRegistryService.onChange(() => setTexlive(texliveOffered())),
		[],
	);

	const due = needsTexliveMove(data?.projectMetadata);
	const projectId = fileStoreService.getCurrentProjectId() || undefined;

	useEffect(() => {
		if (!due || !doc || readOnly || !caughtUp || !texlive || !projectId) {
			return;
		}
		// Where this browser kept the browser compiler's engine and main
		// document for the project.
		const scope = { scope: 'project' as const, projectId };
		const local = {
			engine: getProperty('latex-engine', scope),
			mainFile: getProperty('latex-main-file', scope),
		};
		const map = doc.getMap('data');
		let moved = false;
		doc.transact(() => {
			const stored = map.get('projectMetadata') as ProjectMetadata | undefined;
			if (!stored || !needsTexliveMove(stored)) return;
			map.set(
				'projectMetadata',
				movedToTexlive(JSON.parse(JSON.stringify(stored)), local),
			);
			moved = true;
		});
		if (!moved) return;
		if (local.engine !== undefined) {
			setProperty('latex-engine', undefined, scope);
		}
		if (local.mainFile !== undefined) {
			setProperty('latex-main-file', undefined, scope);
		}
	}, [
		due,
		doc,
		readOnly,
		caughtUp,
		texlive,
		projectId,
		getProperty,
		setProperty,
	]);
}
