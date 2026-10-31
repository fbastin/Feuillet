// src/utils/trackChangesUtils.ts
// Whose changes are tracked, kept with the project for all its files, as on
// Overleaf: everyone's, or those of chosen accounts.
import type { ProjectMetadata, TrackChangesSetting } from '../types/documents';

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Whether an account's changes are tracked. */
export function isTracked(
	setting: TrackChangesSetting | undefined,
	username: string | undefined,
): boolean {
	if (setting?.everyone) return true;
	return Boolean(
		username && setting?.users?.some((user) => same(user, username)),
	);
}

/** Whether a given account is tracked, everyone's being apart. */
export function isUserTracked(
	setting: TrackChangesSetting | undefined,
	username: string,
): boolean {
	return Boolean(setting?.users?.some((user) => same(user, username)));
}

const withSetting = (
	metadata: ProjectMetadata,
	setting: TrackChangesSetting,
): ProjectMetadata => {
	const { trackChanges: _previous, ...rest } = metadata;
	const users = setting.users?.length ? setting.users : undefined;
	return setting.everyone || users
		? {
				...rest,
				trackChanges: {
					...(setting.everyone ? { everyone: true } : {}),
					...(users ? { users } : {}),
				},
			}
		: rest;
};

/** The metadata with everyone's changes tracked, or not. */
export function withEveryoneTracked(
	metadata: ProjectMetadata,
	everyone: boolean,
): ProjectMetadata {
	return withSetting(metadata, { ...metadata.trackChanges, everyone });
}

/** The metadata with an account's changes tracked, or not. */
export function withUserTracked(
	metadata: ProjectMetadata,
	username: string,
	tracked: boolean,
): ProjectMetadata {
	const others = (metadata.trackChanges?.users ?? []).filter(
		(user) => !same(user, username),
	);
	return withSetting(metadata, {
		...metadata.trackChanges,
		users: tracked ? [...others, username] : others,
	});
}

/**
 * The metadata once the per-file tracking of before is the project's:
 * files tracked for everyone make everyone tracked, and a file someone
 * tracked their own changes in makes them tracked.
 */
export function withLegacyTracking(
	metadata: ProjectMetadata,
	trackedHere: { username?: string; ownChanges: boolean },
): ProjectMetadata {
	const { trackedFiles, ...rest } = metadata;
	let next: ProjectMetadata = rest;
	if (trackedFiles?.length) next = withEveryoneTracked(next, true);
	if (trackedHere.ownChanges && trackedHere.username) {
		next = withUserTracked(next, trackedHere.username, true);
	}
	return next;
}
