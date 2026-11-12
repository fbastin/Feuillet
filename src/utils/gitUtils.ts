import { t } from '@/i18n';
import type { GitRemoteBranch, GitRemoteProvider } from '../types/gitRemote';

/**
 * A request to a Git host's API that failed, with its HTTP status. A token
 * the host refuses (401) says so plainly, so that one connects again rather
 * than reading "Bad credentials".
 */
/**
 * When a host that refused requests for going too fast lets them through
 * again, from its answer's headers (GitHub's X-RateLimit-Reset, or
 * Retry-After for its per-minute limit).
 */
export const rateLimitResetOf = (response: Response): number | undefined => {
	const headers = response.headers;
	if (!headers) return undefined;
	const reset = Number(headers.get('X-RateLimit-Reset'));
	if (reset > 0 && headers.get('X-RateLimit-Remaining') === '0') {
		return reset * 1000;
	}
	const retry = Number(headers.get('Retry-After'));
	return retry > 0 ? Date.now() + retry * 1000 : undefined;
};

const WRITES = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

export function gitRemoteRequestError(
	providerName: string,
	endpoint: string,
	status: number,
	detail?: string,
	retryAt?: number,
	method?: string,
): Error & { status: number; rateLimited?: boolean } {
	if ((status === 403 || status === 429) && /rate limit/i.test(detail ?? '')) {
		const message = retryAt
			? t(
					'{provider} limits how many requests an account makes, and this one reached the limit for now. Try again after {time}.',
					{
						provider: providerName,
						time: new Date(retryAt).toLocaleTimeString(undefined, {
							hour: '2-digit',
							minute: '2-digit',
						}),
					},
				)
			: t(
					'{provider} limits how many requests an account makes, and this one reached the limit for now. Try again in a few minutes.',
					{ provider: providerName },
				);
		return Object.assign(new Error(message), {
			status,
			rateLimited: true,
		});
	}
	// A token without the right to write: GitHub says « not accessible by
	// personal access token » (fine-grained), or answers 404 to a write in a
	// repository (classic token without the repo scope).
	// A refusal naming a scope (« workflow ») is left as it is: the Actions
	// part of the window asks for that scope itself.
	const tokenCannotWrite =
		!/scope|workflow/i.test(detail ?? '') &&
		((status === 403 && /not accessible by/i.test(detail ?? '')) ||
			((status === 403 || status === 404) &&
				WRITES.has((method ?? '').toUpperCase()) &&
				/^\/?repos\//.test(endpoint)));
	const message =
		status === 401
			? t(
					'{provider} refused the saved token: it has expired or was revoked. Connect to {provider} again.',
					{ provider: providerName },
				)
			: tokenCannotWrite
				? t(
						'{provider} refused: the token is not allowed to change this repository. A fine-grained token needs « Contents: Read and write » on it, a classic token the « repo » scope. Change the token with « Change token ».',
						{ provider: providerName },
					)
				: `${providerName} API request to '${endpoint.split('?')[0]}' failed (${status})${detail ? `: ${detail}` : ''}`;
	return Object.assign(new Error(message), {
		status,
		// The token, not the account, lacks the right: its own message stays.
		...(/not accessible by/i.test(detail ?? '') ? { tokenScope: true } : {}),
	});
}

/**
 * Why an action on a repository failed, said plainly, when the account
 * cannot see it (a private repository it was not added to) or may not push
 * to it: who to ask, by their name on the host. Null when that is not why.
 */
export async function explainRepositoryAccess(
	provider: GitRemoteProvider,
	token: string,
	repositoryId: string,
	login: string | undefined,
	failure: unknown,
): Promise<string | null> {
	if (!provider.repositoryAccess) return null;
	const refused = failure as { status?: number; tokenScope?: boolean } | null;
	const access = await provider
		.repositoryAccess(token, repositoryId)
		.catch(() => null);
	if (!access) return null;
	const cannotPush =
		access.visible &&
		access.canPush === false &&
		!refused?.tokenScope &&
		(refused?.status === 403 || refused?.status === 404);
	if (access.visible && !cannotPush) return null;
	const account =
		login ??
		(await provider
			.getAccount?.(token)
			.then((found) => found.login)
			.catch(() => undefined));
	// One's own repository: the token, not the account, is short of rights.
	if (!account || account.toLowerCase() === access.owner.toLowerCase())
		return null;
	const params = {
		provider: provider.displayName,
		login: account,
		repository: repositoryId,
		owner: access.owner,
	};
	if (!access.visible)
		return access.ownerIsOrganization
			? t(
					'Your {provider} account ({login}) does not see the repository {repository}: it is private and your account has no access to it, or it was deleted. Ask an owner of the {owner} organization to give your account access on {provider}, then try again.',
					params,
				)
			: t(
					'Your {provider} account ({login}) does not see the repository {repository}: it is private and your account was not added to it, or it was deleted. Ask its owner, {owner}, to add you as a collaborator on {provider} (Settings › Collaborators), accept the invitation {provider} sends you, then try again.',
					params,
				);
	return access.ownerIsOrganization
		? t(
				'Your {provider} account ({login}) can read the repository {repository} but not change it. Ask an owner of the {owner} organization to give your account the Write role on {provider}, then try again.',
				params,
			)
		: t(
				'Your {provider} account ({login}) can read the repository {repository} but not change it. Ask its owner, {owner}, to give you write access on {provider}, then try again.',
				params,
			);
}

/**
 * The remote branch moved while a push was being made (someone else pushed
 * at the same time): pulling what came, then pushing again, settles it.
 */
export class GitRemoteMovedError extends Error {
	constructor(detail: string) {
		super(detail);
		this.name = 'GitRemoteMovedError';
	}
}

export const isRemoteMoved = (error: unknown): boolean =>
	error instanceof GitRemoteMovedError ||
	(error as { name?: string } | null)?.name === 'GitRemoteMovedError';

/** Whether a Git host refused requests for going too fast. */
export const isRateLimited = (error: unknown): boolean =>
	(error as { rateLimited?: boolean } | null)?.rateLimited === true;

/** Whether a Git host refused the saved token. */
export const isRejectedToken = (error: unknown): boolean =>
	(error as { status?: number } | null)?.status === 401;

interface GitRemoteApiRequestOptions {
	providerName: string;
	baseUrl: string;
	token: string;
	endpoint: string;
	requestTimeout: number;
	authHeaders: (token: string) => Record<string, string>;
	options?: RequestInit;
}

export async function gitRemoteApiRequest<T>({
	providerName,
	baseUrl,
	token,
	endpoint,
	requestTimeout,
	authHeaders,
	options = {},
}: GitRemoteApiRequestOptions): Promise<T> {
	const headers = new Headers(authHeaders(token));
	if (options.body) headers.set('Content-Type', 'application/json');
	new Headers(options.headers).forEach((value, key) => {
		headers.set(key, value);
	});

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), requestTimeout * 1000);
	try {
		const response = await fetch(
			`${baseUrl.replace(/\/$/, '')}/${endpoint.replace(/^\//, '')}`,
			{ ...options, headers, signal: controller.signal },
		);
		if (!response.ok) {
			const body = (await response.json().catch(() => ({}))) as {
				message?: string | Record<string, unknown>;
				error?: string;
			};
			const detail =
				typeof body.message === 'string'
					? body.message
					: body.error || response.statusText;
			throw gitRemoteRequestError(
				providerName,
				endpoint,
				response.status,
				detail || response.statusText,
				rateLimitResetOf(response),
				options.method,
			);
		}
		return response.status === 204 ? (undefined as T) : response.json();
	} catch (error) {
		if (error instanceof Error && error.name === 'AbortError') {
			throw new Error(
				`${providerName} API request timed out after ${requestTimeout} seconds`,
			);
		}
		throw error;
	} finally {
		clearTimeout(timeoutId);
	}
}

export function normalizeGitRepositoryInput(input: string): string {
	const trimmed = input.trim();
	if (!trimmed) return '';
	try {
		return new URL(trimmed).pathname.replace(/^\/+/, '').replace(/\.git$/, '');
	} catch {
		const ssh = trimmed.match(/^[^@\s]+@[^:\s]+:(.+)$/);
		return (ssh?.[1] ?? trimmed).replace(/^\/+/, '').replace(/\.git$/, '');
	}
}

export function gitRepositoryParts(
	repositoryId: string,
	providerName: string,
): [string, string] {
	const [owner, repo] = normalizeGitRepositoryInput(repositoryId).split('/');
	if (!owner || !repo) throw new Error(`Invalid ${providerName} repository`);
	return [owner, repo];
}

export function base64ToBytes(value: string): Uint8Array {
	const binary = atob(value.replace(/[\r\n]/g, ''));
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

export async function ensureGitRemoteBranch(
	provider: GitRemoteProvider,
	token: string,
	repositoryId: string,
	branch: string,
	branches: GitRemoteBranch[],
	preferredSource?: string,
): Promise<void> {
	const target = branch.trim();
	if (
		!target ||
		branches.some((item) => item.name === target) ||
		branches.length === 0
	) {
		return;
	}
	if (!provider.createBranch) {
		throw new Error(`${provider.displayName} cannot create remote branches`);
	}
	const source =
		branches.find((item) => item.name === preferredSource) ??
		branches.find((item) => item.name === 'main') ??
		branches.find((item) => item.name === 'master') ??
		branches[0];
	await provider.createBranch(token, repositoryId, target, source.name);
}
