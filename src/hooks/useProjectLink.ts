// src/hooks/useProjectLink.ts
import { useEffect, useState } from 'react';

import { projectLinkService } from '../services/ProjectLinkService';

interface ProjectLink {
	// The id the collaboration server opens the project under.
	serverId: string;
	// The link this device holds no longer opens the project.
	cutOff: boolean;
}

const readLink = (projectId: string): ProjectLink => ({
	serverId: projectLinkService.serverId(projectId),
	cutOff: projectLinkService.isCutOff(projectId),
});

export const useProjectLink = (projectId: string): ProjectLink => {
	const [link, setLink] = useState(() => readLink(projectId));

	useEffect(() => {
		const update = (changed: string) => {
			if (changed !== projectId) return;
			setLink((current) => {
				const next = readLink(projectId);
				return current.serverId === next.serverId &&
					current.cutOff === next.cutOff
					? current
					: next;
			});
		};
		update(projectId);
		const offLink = projectLinkService.addListener(update);
		const offCutOff = projectLinkService.addCutOffListener(update);
		return () => {
			offLink();
			offCutOff();
		};
	}, [projectId]);

	return link;
};
