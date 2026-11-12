// src/hooks/useAccessRequests.ts
// Access requests, as Overleaf's: for a project's owner, how many wait (the
// count on the Share button); for whoever asked, the request waiting, and
// the access once granted. Asked of the collaboration server when the
// project opens, when the window comes back to it, every two minutes while
// a request waits, and when one is made or decided here.
import { useCallback, useEffect, useRef, useState } from 'react';

import {
	ACCESS_REQUESTS_CHANGED,
	type ProjectRole,
	type RequestedRole,
	accountSyncService,
} from '../services/AccountSyncService';

export interface AccessRequestState {
	/** For the owner: the requests waiting. */
	count: number;
	/** For whoever asked: the role asked for. */
	requested?: RequestedRole;
	/** The request granted, since the project opened. */
	granted?: { role: ProjectRole; edit?: string };
}

const FOCUS_MS = 30 * 1000;
const WAITING_MS = 2 * 60 * 1000;

const meets = (role: ProjectRole | null, asked: RequestedRole) =>
	role === 'owner' ||
	role === 'editor' ||
	(role === 'reviewer' && asked === 'reviewer');

export const useAccessRequests = (
	projectId: string,
	enabled: boolean,
): AccessRequestState => {
	const [state, setState] = useState<AccessRequestState>({ count: 0 });
	const lastAsked = useRef(0);

	const refresh = useCallback(async () => {
		if (!enabled) return;
		lastAsked.current = Date.now();
		try {
			const access = await accountSyncService.projectAccess(projectId);
			if (!access) return;
			setState((previous) => {
				const granted =
					previous.granted ??
					(previous.requested &&
					!access.requested &&
					meets(access.role, previous.requested)
						? {
								role: access.role as ProjectRole,
								...(access.edit ? { edit: access.edit } : {}),
							}
						: undefined);
				return {
					count: access.requests ?? 0,
					...(access.requested ? { requested: access.requested } : {}),
					...(granted ? { granted } : {}),
				};
			});
		} catch {
			// A link replaced, the server out of reach: as it was.
		}
	}, [projectId, enabled]);

	useEffect(() => {
		setState({ count: 0 });
		void refresh();
		const changed = (event: Event) => {
			if ((event as CustomEvent).detail?.projectId === projectId) {
				void refresh();
			}
		};
		const focused = () => {
			if (Date.now() - lastAsked.current >= FOCUS_MS) void refresh();
		};
		window.addEventListener(ACCESS_REQUESTS_CHANGED, changed);
		window.addEventListener('focus', focused);
		return () => {
			window.removeEventListener(ACCESS_REQUESTS_CHANGED, changed);
			window.removeEventListener('focus', focused);
		};
	}, [projectId, refresh]);

	// While a request waits, its answer comes without reopening.
	useEffect(() => {
		if (!state.requested) return;
		const timer = setInterval(() => void refresh(), WAITING_MS);
		return () => clearInterval(timer);
	}, [state.requested, refresh]);

	return state;
};
