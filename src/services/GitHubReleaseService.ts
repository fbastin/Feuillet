// src/services/GitHubReleaseService.ts
// « Publier une version sur GitHub », as a release with the project's PDF:
// a draft first, the PDF attached through Feuillet's server, then the
// release published; a draft whose PDF could not be attached is removed,
// so that nothing half made is left on GitHub.
import type {
	GitRemoteReleaseInput,
	GitRemoteReleases,
} from '../types/gitRemote';

export interface ReleaseAsset {
	name: string;
	type: string;
	bytes: Uint8Array;
}

export interface PublishedRelease {
	url: string;
	tagName: string;
	assetUrl?: string;
}

export class ReleaseUploadError extends Error {
	constructor(
		readonly code: string,
		readonly status?: number,
		readonly detail?: string,
	) {
		super(detail || code);
	}
}

/** Sends an asset to the release; its download address. */
export type AssetUploader = (
	releaseId: number,
	asset: ReleaseAsset,
) => Promise<string | undefined>;

export async function publishRelease({
	releases,
	token,
	repositoryId,
	input,
	asset,
	upload,
}: {
	releases: GitRemoteReleases;
	token: string;
	repositoryId: string;
	input: GitRemoteReleaseInput;
	asset?: ReleaseAsset;
	upload: AssetUploader;
}): Promise<PublishedRelease> {
	const draft = await releases.createDraft(token, repositoryId, input);
	let assetUrl: string | undefined;
	try {
		if (asset) assetUrl = await upload(draft.id, asset);
		const published = await releases.publish(token, repositoryId, draft.id);
		return { ...published, assetUrl };
	} catch (error) {
		await releases.remove(token, repositoryId, draft.id).catch(() => {});
		throw error;
	}
}
