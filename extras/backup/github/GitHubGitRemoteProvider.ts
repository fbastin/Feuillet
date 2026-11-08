import type {
	GitRemoteCommitObject,
	GitRemoteProvider,
	GitRemotePullRequest,
	GitRemotePullRequests,
	GitRemoteReleases,
	GitRemoteWorkflows,
	GitRemoteSignature,
	GitRemoteTreeEntry,
} from '@/types/gitRemote';
import { forEachLimited } from '@/utils/asyncLimit';
import { toBase64 } from '@/utils/fileUtils';
import {
	GitRemoteMovedError,
	base64ToBytes,
	gitRemoteApiRequest,
	gitRepositoryParts,
	normalizeGitRepositoryInput,
} from '@/utils/gitUtils';
import { gitHubAPIService } from './GitHubAPIService';

const repositoryParts = (repositoryId: string): [string, string] =>
	gitRepositoryParts(repositoryId, 'GitHub');

let apiConfiguration = {
	endpoint: 'https://api.github.com',
	requestTimeout: 30,
};

const request = <T>(
	token: string,
	endpoint: string,
	options: RequestInit = {},
): Promise<T> =>
	gitRemoteApiRequest<T>({
		providerName: 'GitHub',
		baseUrl: gitHubAPIService.getBaseUrl(),
		token,
		endpoint,
		requestTimeout: apiConfiguration.requestTimeout,
		authHeaders: (credential) => ({
			Authorization: `token ${credential}`,
			Accept: 'application/vnd.github.v3+json',
		}),
		// Fresh answers, as in GitHubAPIService: pull requests, workflow files
		// and releases change on GitHub between two looks.
		options: { cache: 'no-cache', ...options },
	});

// A commit as GitHub's Git data API and its commits list both give it.
interface GitHubGitCommit {
	message: string;
	tree: { sha: string };
	parents?: Array<{ sha: string }>;
	author: { name?: string; email?: string; date?: string };
	committer: { name?: string; email?: string; date?: string };
	verification?: { signature?: string | null; payload?: string | null };
}

const COMMITS_PAGE_SIZE = 100;
// GitHub's GraphQL API reads fifty files for one point of its limit, and
// cuts texts short past about 512 KB (said by isTruncated).
const TEXT_BLOBS_PER_QUERY = 50;
const TREES_PER_QUERY = 50;
// GraphQL requests at once: far below GitHub's 100 at a time and 2,000
// points a minute.
const GRAPHQL_CONCURRENCY = 3;

/**
 * Where GitHub's GraphQL endpoint is, beside its REST one: /graphql for
 * api.github.com, /api/graphql for an Enterprise server's /api/v3.
 */
const graphqlBase = (): string =>
	apiConfiguration.endpoint.replace(/\/$/, '').replace(/\/api\/v3$/i, '/api');

const graphql = async <T>(
	token: string,
	query: string,
	variables: Record<string, unknown>,
): Promise<T> => {
	const result = await gitRemoteApiRequest<{
		data?: T;
		errors?: Array<{ message?: string }>;
	}>({
		providerName: 'GitHub',
		baseUrl: graphqlBase(),
		token,
		endpoint: 'graphql',
		requestTimeout: apiConfiguration.requestTimeout,
		authHeaders: (credential) => ({ Authorization: `bearer ${credential}` }),
		options: {
			method: 'POST',
			body: JSON.stringify({ query, variables }),
		},
	});
	if (!result.data) {
		throw new Error(
			`GitHub GraphQL request failed: ${result.errors?.[0]?.message ?? 'no data'}`,
		);
	}
	return result.data;
};
const MAX_LISTED_COMMITS = 5000;

// Pushing: text up to this much in all goes in the tree request.
const MAX_INLINE_BYTES = 4 * 1024 * 1024;
const MAX_INLINE_FILE_BYTES = 1024 * 1024;
const UPLOAD_CONCURRENCY = 4;
const UNSPACED_UPLOADS = 40;
const UPLOAD_SPACING_MS = 800;

const strictUtf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** A file's text, when it is UTF-8 and small enough to send as such. */
const inlineText = (content: Uint8Array): string | null => {
	if (content.length > MAX_INLINE_FILE_BYTES || content.includes(0)) {
		return null;
	}
	try {
		return strictUtf8.decode(content);
	} catch {
		return null;
	}
};

const normalizeSignature = (signature: {
	name?: string;
	email?: string;
	date?: string;
}): GitRemoteSignature => ({
	name: signature.name || 'Unknown',
	email: signature.email || 'unknown@local',
	date: signature.date || new Date(0).toISOString(),
});

const webBaseUrl = (): string => {
	const endpoint = apiConfiguration.endpoint.replace(/\/$/, '');
	if (/^https:\/\/api\.github\.com$/i.test(endpoint))
		return 'https://github.com';
	return endpoint.replace(/\/api\/v3$/i, '');
};

const applyApiConfiguration = (
	configuration: typeof apiConfiguration,
): void => {
	apiConfiguration = { ...configuration };
	gitHubAPIService.setBaseUrl(configuration.endpoint);
	gitHubAPIService.setRequestTimeout(configuration.requestTimeout);
};

const bootstrapEmptyRepository = async (
	token: string,
	owner: string,
	repo: string,
	branch: string,
): Promise<string | null> => {
	try {
		await request(token, `repos/${owner}/${repo}/git/matching-refs/heads`);
		return null;
	} catch (error) {
		if ((error as { status?: number }).status !== 409) throw error;
	}

	const repository = await request<{ default_branch: string }>(
		token,
		`repos/${owner}/${repo}`,
	);
	if (branch !== repository.default_branch) {
		throw new Error(
			`GitHub requires the first push to an empty repository to initialize its default branch (${repository.default_branch}).`,
		);
	}
	const initialized = await request<{ commit: { sha: string } }>(
		token,
		`repos/${owner}/${repo}/contents/.texlyre-init`,
		{
			method: 'PUT',
			body: JSON.stringify({
				message: 'Initialize Git repository',
				content: 'Cg==',
			}),
		},
	);
	return initialized.commit.sha;
};

// « Publier une version sur GitHub »: the PDF is attached in between, through
// Feuillet's server (server/collab/releases.js).
const releases: GitRemoteReleases = {
	latestTag: async (token, repositoryId) => {
		const [owner, repo] = repositoryParts(repositoryId);
		const list = await request<{ tag_name?: string }[]>(
			token,
			`repos/${owner}/${repo}/releases?per_page=1`,
		);
		return list[0]?.tag_name ?? null;
	},
	tagExists: async (token, repositoryId, tag) => {
		const [owner, repo] = repositoryParts(repositoryId);
		try {
			await request(
				token,
				`repos/${owner}/${repo}/git/ref/tags/${encodeURIComponent(tag)}`,
			);
			return true;
		} catch (error) {
			if ((error as { status?: number }).status === 404) return false;
			throw error;
		}
	},
	createDraft: async (token, repositoryId, input) => {
		const [owner, repo] = repositoryParts(repositoryId);
		const release = await request<{ id: number }>(
			token,
			`repos/${owner}/${repo}/releases`,
			{
				method: 'POST',
				body: JSON.stringify({
					tag_name: input.tagName,
					target_commitish: input.targetCommitish,
					name: input.name,
					body: input.body,
					prerelease: input.prerelease,
					draft: true,
				}),
			},
		);
		return { id: release.id };
	},
	publish: async (token, repositoryId, id) => {
		const [owner, repo] = repositoryParts(repositoryId);
		const release = await request<{ html_url: string; tag_name: string }>(
			token,
			`repos/${owner}/${repo}/releases/${id}`,
			{ method: 'PATCH', body: JSON.stringify({ draft: false }) },
		);
		return { url: release.html_url, tagName: release.tag_name };
	},
	remove: async (token, repositoryId, id) => {
		const [owner, repo] = repositoryParts(repositoryId);
		await request(token, `repos/${owner}/${repo}/releases/${id}`, {
			method: 'DELETE',
		});
	},
};

const commitObjectOf = (
	sha: string,
	data: GitHubGitCommit,
	parents: Array<{ sha: string }> = [],
): GitRemoteCommitObject => ({
	oid: sha,
	message: data.message,
	parents: parents.map((parent) => parent.sha),
	author: normalizeSignature(data.author),
	committer: normalizeSignature(data.committer),
	treeOid: data.tree.sha,
	...(data.verification?.signature
		? { gpgsig: data.verification.signature }
		: {}),
	...(data.verification?.payload
		? { unsignedPayload: data.verification.payload }
		: {}),
});

const historyTransport: GitRemoteProvider['historyTransport'] = {
	preservesCommitOids: true,
	supportsMergeCommits: true,
	getHead: async (token, repositoryId, branch) => {
		const [owner, repo] = repositoryParts(repositoryId);
		try {
			return await gitHubAPIService.getBranchHeadSha(
				token,
				owner,
				repo,
				branch,
			);
		} catch (error) {
			if (
				(error as { status?: number }).status === 404 ||
				/not found/i.test(String(error))
			)
				return null;
			throw error;
		}
	},
	getCommit: async (token, repositoryId, oid) => {
		const [owner, repo] = repositoryParts(repositoryId);
		const data = await request<GitHubGitCommit & { sha: string }>(
			token,
			`repos/${owner}/${repo}/git/commits/${encodeURIComponent(oid)}`,
		);
		return commitObjectOf(data.sha, data, data.parents);
	},
	// The commits list gives each commit as the Git data API does (checked
	// against it: message, tree, signatures, dates, parents), a hundred a
	// request.
	listCommits: async (
		token,
		repositoryId,
		head,
		{ known, limit = MAX_LISTED_COMMITS },
	) => {
		const [owner, repo] = repositoryParts(repositoryId);
		const commits: GitRemoteCommitObject[] = [];
		for (let page = 1; commits.length < limit; page++) {
			const batch = await request<
				Array<{
					sha: string;
					commit: GitHubGitCommit;
					parents: Array<{ sha: string }>;
				}>
			>(
				token,
				`repos/${owner}/${repo}/commits?sha=${encodeURIComponent(head)}&per_page=${COMMITS_PAGE_SIZE}&page=${page}`,
			);
			let reachedKnown = false;
			for (const item of batch) {
				commits.push(commitObjectOf(item.sha, item.commit, item.parents));
				if (!reachedKnown && known && (await known(item.sha))) {
					reachedKnown = true;
				}
			}
			if (reachedKnown || batch.length < COMMITS_PAGE_SIZE) break;
		}
		return commits;
	},
	getTree: async (token, repositoryId, commit) => {
		const [owner, repo] = repositoryParts(repositoryId);
		if (!commit.treeOid)
			throw new Error('GitHub commit did not include a tree');
		const entries: GitRemoteTreeEntry[] = [];

		// The whole tree in one request; folder by folder only when GitHub
		// cuts it short (beyond 100,000 entries).
		const whole = await request<{
			tree: Array<{
				path: string;
				mode: string;
				type: 'blob' | 'tree' | 'commit';
				sha: string;
				size?: number;
			}>;
			truncated?: boolean;
		}>(
			token,
			`repos/${owner}/${repo}/git/trees/${encodeURIComponent(commit.treeOid)}?recursive=1`,
		);
		if (!whole.truncated) {
			for (const entry of whole.tree) {
				if (entry.type === 'tree') continue;
				entries.push({
					path: entry.path,
					mode: entry.mode,
					type: entry.type,
					oid: entry.sha,
					...(typeof entry.size === 'number' ? { size: entry.size } : {}),
				});
			}
			return entries;
		}

		const walk = async (treeOid: string, prefix = ''): Promise<void> => {
			const data = await request<{
				tree: Array<{
					path: string;
					mode: string;
					type: 'blob' | 'tree' | 'commit';
					sha: string;
				}>;
				truncated?: boolean;
			}>(
				token,
				`repos/${owner}/${repo}/git/trees/${encodeURIComponent(treeOid)}`,
			);
			if (data.truncated) {
				throw new Error(
					'GitHub returned a truncated Git tree; History sync cannot reproduce this commit exactly.',
				);
			}
			for (const entry of data.tree) {
				const path = prefix ? `${prefix}/${entry.path}` : entry.path;
				if (entry.type === 'tree') {
					await walk(entry.sha, path);
					continue;
				}
				entries.push({
					path,
					mode: entry.mode,
					type: entry.type,
					oid: entry.sha,
				});
			}
		};

		await walk(commit.treeOid);
		return entries;
	},
	getTreeLevels: async (token, repositoryId, treeOids) => {
		const [owner, repo] = repositoryParts(repositoryId);
		const levels = new Map<string, GitRemoteTreeEntry[]>();
		let queue = [...new Set(treeOids)];
		while (queue.length > 0) {
			const next = new Set<string>();
			const parts: string[][] = [];
			for (let start = 0; start < queue.length; start += TREES_PER_QUERY) {
				parts.push(queue.slice(start, start + TREES_PER_QUERY));
			}
			await forEachLimited(parts, GRAPHQL_CONCURRENCY, async (part) => {
				const fields = part
					.map(
						(oid, index) =>
							`t${index}: object(oid: ${JSON.stringify(oid)}) { ... on Tree { entries { name mode type oid size } } }`,
					)
					.join(' ');
				const data = await graphql<{
					repository: Record<
						string,
						{
							entries?: Array<{
								name: string;
								mode: number;
								type: 'blob' | 'tree' | 'commit';
								oid: string;
								size: number;
							}>;
						} | null
					> | null;
				}>(
					token,
					`query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`,
					{ owner, name: repo },
				);
				part.forEach((oid, index) => {
					const entries = data.repository?.[`t${index}`]?.entries;
					if (!entries) return;
					levels.set(
						oid,
						entries.map((entry) => ({
							path: entry.name,
							mode: entry.mode.toString(8).padStart(6, '0'),
							type: entry.type,
							oid: entry.oid,
							...(entry.type === 'blob' ? { size: entry.size } : {}),
						})),
					);
					for (const entry of entries) {
						if (entry.type === 'tree' && !levels.has(entry.oid)) {
							next.add(entry.oid);
						}
					}
				});
			});
			queue = [...next].filter((oid) => !levels.has(oid));
		}
		return levels;
	},
	getTextBlobs: async (token, repositoryId, oids) => {
		const [owner, repo] = repositoryParts(repositoryId);
		const texts = new Map<string, Uint8Array>();
		const encoder = new TextEncoder();
		const parts: string[][] = [];
		for (let start = 0; start < oids.length; start += TEXT_BLOBS_PER_QUERY) {
			parts.push(oids.slice(start, start + TEXT_BLOBS_PER_QUERY));
		}
		await forEachLimited(parts, GRAPHQL_CONCURRENCY, async (part) => {
			const fields = part
				.map(
					(oid, index) =>
						`b${index}: object(oid: ${JSON.stringify(oid)}) { ... on Blob { text isBinary isTruncated } }`,
				)
				.join(' ');
			const data = await graphql<{
				repository: Record<
					string,
					{
						text: string | null;
						isBinary: boolean;
						isTruncated: boolean;
					} | null
				> | null;
			}>(
				token,
				`query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`,
				{ owner, name: repo },
			);
			part.forEach((oid, index) => {
				const blob = data.repository?.[`b${index}`];
				if (
					blob &&
					!blob.isBinary &&
					!blob.isTruncated &&
					typeof blob.text === 'string'
				) {
					texts.set(oid, encoder.encode(blob.text));
				}
			});
		});
		return texts;
	},
	getBlob: async (token, repositoryId, oid) => {
		const [owner, repo] = repositoryParts(repositoryId);
		const data = await request<{ content: string; encoding: string }>(
			token,
			`repos/${owner}/${repo}/git/blobs/${encodeURIComponent(oid)}`,
		);
		if (data.encoding !== 'base64') {
			throw new Error(`Unsupported GitHub blob encoding: ${data.encoding}`);
		}
		return base64ToBytes(data.content);
	},
	createCommit: async (token, repositoryId, input) => {
		const [owner, repo] = repositoryParts(repositoryId);
		const bootstrapHead =
			input.parents.length === 0
				? await bootstrapEmptyRepository(token, owner, repo, input.branch)
				: null;
		const baseCommit = input.parents[0]
			? await historyTransport.getCommit(token, repositoryId, input.parents[0])
			: null;
		if (baseCommit && !baseCommit.treeOid) {
			throw new Error('GitHub parent commit did not include a tree');
		}
		// Text goes in the tree request itself, which GitHub writes byte for
		// byte (checked: BOM, CRLF, CR, accents, no final newline): one
		// request for all of it. Other files are uploaded a few at a time;
		// many of them, spaced, for GitHub refuses more than 80 such
		// requests a minute.
		const tree: Array<{
			path: string;
			mode: string;
			type: 'blob' | 'commit';
			sha?: string | null;
			content?: string;
		}> = [];
		const uploads: Array<{ index: number; content: Uint8Array }> = [];
		let inlined = 0;
		for (const change of input.changes) {
			if (change.type === 'delete') {
				tree.push({
					path: change.path,
					mode: change.mode ?? '100644',
					type: change.mode === '160000' ? 'commit' : 'blob',
					sha: null,
				});
				continue;
			}
			if (change.mode === '160000') {
				// A submodule: the commit it points to, nothing to upload.
				tree.push({
					path: change.path,
					mode: '160000',
					type: 'commit',
					sha: change.oid ?? null,
				});
				continue;
			}
			const content = change.content ?? new Uint8Array();
			const text =
				inlined + content.length <= MAX_INLINE_BYTES
					? inlineText(content)
					: null;
			if (text !== null) {
				inlined += content.length;
				tree.push({
					path: change.path,
					mode: change.mode ?? '100644',
					type: 'blob',
					content: text,
				});
				continue;
			}
			uploads.push({ index: tree.length, content });
			tree.push({
				path: change.path,
				mode: change.mode ?? '100644',
				type: 'blob',
			});
		}
		await forEachLimited(
			uploads,
			UPLOAD_CONCURRENCY,
			async ({ index, content }) => {
				const blob = await request<{ sha: string }>(
					token,
					`repos/${owner}/${repo}/git/blobs`,
					{
						method: 'POST',
						body: JSON.stringify({
							content: toBase64(content),
							encoding: 'base64',
						}),
					},
				);
				tree[index].sha = blob.sha;
			},
			uploads.length > UNSPACED_UPLOADS ? UPLOAD_SPACING_MS : 0,
		);
		const remoteTree = await request<{ sha: string }>(
			token,
			`repos/${owner}/${repo}/git/trees`,
			{
				method: 'POST',
				body: JSON.stringify({
					...(baseCommit?.treeOid ? { base_tree: baseCommit.treeOid } : {}),
					tree,
				}),
			},
		);
		const created = await request<{ sha: string }>(
			token,
			`repos/${owner}/${repo}/git/commits`,
			{
				method: 'POST',
				body: JSON.stringify({
					message: input.message,
					tree: remoteTree.sha,
					parents: input.parents,
					author: input.author,
					committer: input.committer,
				}),
			},
		);
		if (input.updateBranch) {
			const currentHead = await historyTransport.getHead(
				token,
				repositoryId,
				input.branch,
			);
			const isBootstrapHead = Boolean(
				bootstrapHead &&
					currentHead === bootstrapHead &&
					!input.expectedBranchHead,
			);
			if (!isBootstrapHead && currentHead !== input.expectedBranchHead) {
				throw new GitRemoteMovedError(
					'Remote branch changed while preparing the push. Pull first.',
				);
			}
			if (currentHead) {
				try {
					await request(
						token,
						`repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(input.branch)}`,
						{
							method: 'PATCH',
							body: JSON.stringify({
								sha: created.sha,
								force: isBootstrapHead,
							}),
						},
					);
				} catch (error) {
					// Moved between the check and the update: not a fast forward.
					if (
						(error as { status?: number }).status === 422 &&
						/fast.?forward/i.test(String(error))
					) {
						throw new GitRemoteMovedError(
							'Remote branch changed while the push was being made. Pull first.',
						);
					}
					throw error;
				}
			} else {
				await request(token, `repos/${owner}/${repo}/git/refs`, {
					method: 'POST',
					body: JSON.stringify({
						ref: `refs/heads/${input.branch}`,
						sha: created.sha,
					}),
				});
			}
		}
		return historyTransport.getCommit(token, repositoryId, created.sha);
	},
};

interface GitHubPull {
	number: number;
	html_url: string;
	title: string;
	state: 'open' | 'closed';
	draft?: boolean;
	merged_at: string | null;
	base: { ref: string };
	head: { ref: string };
}

const pullOf = (pull: GitHubPull): GitRemotePullRequest => ({
	number: pull.number,
	url: pull.html_url,
	title: pull.title,
	state: pull.merged_at ? 'merged' : pull.state,
	draft: pull.draft === true,
	base: pull.base.ref,
	head: pull.head.ref,
});

// Pull requests between branches of the repository itself.
const pullRequests: GitRemotePullRequests = {
	defaultBranch: async (token, repositoryId) => {
		const [owner, repo] = repositoryParts(repositoryId);
		return (
			await request<{ default_branch: string }>(token, `repos/${owner}/${repo}`)
		).default_branch;
	},
	find: async (token, repositoryId, branch) => {
		const [owner, repo] = repositoryParts(repositoryId);
		const head = encodeURIComponent(`${owner}:${branch}`);
		const pulls = await request<GitHubPull[]>(
			token,
			`repos/${owner}/${repo}/pulls?state=all&head=${head}&sort=created&direction=desc&per_page=5`,
		);
		return pulls[0] ? pullOf(pulls[0]) : null;
	},
	create: async (token, repositoryId, input) => {
		const [owner, repo] = repositoryParts(repositoryId);
		return pullOf(
			await request<GitHubPull>(token, `repos/${owner}/${repo}/pulls`, {
				method: 'POST',
				body: JSON.stringify({
					title: input.title,
					body: input.body,
					head: input.head,
					base: input.base,
					draft: input.draft,
				}),
			}),
		);
	},
};

const contentsPath = (path: string) =>
	path.split('/').map(encodeURIComponent).join('/');

// The GitHub Actions workflow, written on GitHub itself: a token without
// « workflow » is refused there, and nothing changes in the project.
const workflows: GitRemoteWorkflows = {
	tokenScopes: async (token) => {
		try {
			const response = await fetch(`${gitHubAPIService.getBaseUrl()}/user`, {
				headers: {
					Authorization: `token ${token}`,
					Accept: 'application/vnd.github.v3+json',
				},
			});
			const header = response.ok
				? response.headers.get('x-oauth-scopes')
				: null;
			return header === null
				? null
				: header
						.split(',')
						.map((scope) => scope.trim())
						.filter(Boolean);
		} catch {
			return null;
		}
	},
	readFile: async (token, repositoryId, branch, path) => {
		const [owner, repo] = repositoryParts(repositoryId);
		try {
			const file = await request<{ sha: string; content?: string }>(
				token,
				`repos/${owner}/${repo}/contents/${contentsPath(path)}?ref=${encodeURIComponent(branch)}`,
			);
			return {
				sha: file.sha,
				text: new TextDecoder().decode(
					base64ToBytes((file.content ?? '').replace(/\s+/g, '')),
				),
			};
		} catch (error) {
			if ((error as { status?: number }).status === 404) return null;
			throw error;
		}
	},
	writeFile: async (token, repositoryId, input) => {
		const [owner, repo] = repositoryParts(repositoryId);
		await request(
			token,
			`repos/${owner}/${repo}/contents/${contentsPath(input.path)}`,
			{
				method: 'PUT',
				body: JSON.stringify({
					message: input.message,
					content: toBase64(input.text),
					branch: input.branch,
					...(input.sha ? { sha: input.sha } : {}),
				}),
			},
		);
	},
	runsUrl: (repositoryId) => {
		const [owner, repo] = repositoryParts(repositoryId);
		return `${webBaseUrl()}/${owner}/${repo}/actions`;
	},
};

export const gitHubGitRemoteProvider: GitRemoteProvider = {
	id: 'github',
	displayName: 'GitHub',
	historyPluginId: 'texlyre-github-history',
	historyTokenSecretKey: 'github-history-token',
	backupPluginId: 'texlyre-github-backup',
	backupTokenSecretKey: 'github-token',
	configure: (getSetting) => {
		applyApiConfiguration({
			endpoint:
				(getSetting('github-backup-api-endpoint')?.value as string) ||
				'https://api.github.com',
			requestTimeout:
				(getSetting('github-backup-request-timeout')?.value as number) || 30,
		});
	},
	getApiConfiguration: () => ({ ...apiConfiguration }),
	applyApiConfiguration,
	testConnection: (token) => gitHubAPIService.testConnection(token),
	listRepositories: async (token) =>
		(await gitHubAPIService.getRepositories(token)).map((repository) => ({
			id: repository.full_name,
			label: repository.full_name,
			private: repository.private,
			defaultBranch: repository.default_branch,
			language: repository.language ?? undefined,
		})),
	listBranches: async (token, repositoryId) => {
		const [owner, repo] = repositoryParts(repositoryId);
		try {
			return await gitHubAPIService.getBranches(token, owner, repo);
		} catch (error) {
			if (/(?:repository|git).*empty|empty.*repository/i.test(String(error)))
				return [];
			throw error;
		}
	},
	createBranch: async (token, repositoryId, branch, sourceRef) => {
		const [owner, repo] = repositoryParts(repositoryId);
		const sourceOid = await historyTransport.getHead(
			token,
			repositoryId,
			sourceRef,
		);
		if (!sourceOid)
			throw new Error(`Source branch ${sourceRef} does not exist`);
		await request(token, `repos/${owner}/${repo}/git/refs`, {
			method: 'POST',
			body: JSON.stringify({
				ref: `refs/heads/${branch}`,
				sha: sourceOid,
			}),
		});
	},
	createBranchAtCommit: async (token, repositoryId, branch, oid) => {
		const [owner, repo] = repositoryParts(repositoryId);
		await request(token, `repos/${owner}/${repo}/git/refs`, {
			method: 'POST',
			body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: oid }),
		});
	},
	normalizeRepositoryInput: normalizeGitRepositoryInput,
	getAccount: async (token) => {
		const user = await gitHubAPIService.getAuthenticatedUser(token);
		return {
			login: user.login,
			name: user.name || undefined,
			profileUrl: user.html_url,
		};
	},
	createRepository: async (token, input) => {
		const repository = await gitHubAPIService.createRepository(token, input);
		return {
			id: repository.full_name,
			label: repository.full_name,
			private: repository.private,
			defaultBranch: repository.default_branch,
		};
	},
	getRepositoryUrl: (repositoryId, branch) => {
		const [owner, repo] = repositoryParts(repositoryId);
		const base = `${webBaseUrl()}/${owner}/${repo}`;
		return branch ? `${base}/tree/${encodeURIComponent(branch)}` : base;
	},
	getTokenCreationUrl: (appName, options) =>
		`${webBaseUrl()}/settings/tokens/new?scopes=${options?.workflow ? 'repo,workflow' : 'repo'}&description=${encodeURIComponent(appName)}`,
	releases,
	pullRequests,
	workflows,
	historyTransport,
};
