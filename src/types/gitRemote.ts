//src/types/gitRemotes.ts
export interface GitRemoteRepository {
	id: string;
	label: string;
	private?: boolean;
	defaultBranch?: string;
	language?: string;
}

export interface GitRemoteBranch {
	name: string;
	protected?: boolean;
}

export interface GitRemoteAccount {
	login: string;
	name?: string;
	profileUrl?: string;
}

/** What an account may do with a repository, as the remote says. */
export interface GitRepositoryAccess {
	/** Whether it sees it: a private one hides from accounts not added to it. */
	visible: boolean;
	/** Whether it may push to it, when the remote says. */
	canPush?: boolean;
	/** Who owns it (a login), and whether that is an organization. */
	owner: string;
	ownerIsOrganization?: boolean;
}

export interface GitRemoteCreateRepositoryInput {
	name: string;
	description?: string;
	private: boolean;
}

export type GitHistoryCredentialSource =
	| 'history'
	| 'backup-project'
	| 'backup-global';

export interface GitRemoteCredentialRef {
	pluginId: string;
	secretKey: string;
	scope: 'project' | 'global';
}

export interface GitRemoteApiConfiguration {
	endpoint: string;
	requestTimeout: number;
}

export interface GitRemoteSyncBase {
	localOid: string;
	remoteOid: string;
}

export interface GitRemoteConfig {
	providerId: string;
	providerName?: string;
	apiConfiguration?: GitRemoteApiConfiguration;
	repositoryId: string;
	repositoryLabel: string;
	branch: string;
	credentialSource: GitHistoryCredentialSource;
	credentialRef?: GitRemoteCredentialRef;
	syncBase?: GitRemoteSyncBase;
}

export interface GitRemoteSignature {
	name: string;
	email: string;
	date: string;
}

export type GitRemoteTreeEntryType = 'blob' | 'tree' | 'commit';

export interface GitRemoteTreeEntry {
	path: string;
	mode: string;
	type: GitRemoteTreeEntryType;
	oid: string;
	/** A file's size in bytes, when the provider tells it. */
	size?: number;
}

export interface GitRemoteCommitObject {
	oid: string;
	message: string;
	parents: string[];
	author: GitRemoteSignature;
	committer: GitRemoteSignature;
	treeOid?: string;
	gpgsig?: string;
	unsignedPayload?: string;
}

export interface GitRemoteCommitChange {
	path: string;
	type: 'create' | 'update' | 'delete';
	mode?: string;
	previousMode?: string;
	previousOid?: string;
	content?: Uint8Array;
	/** For a submodule (mode 160000): the commit it points to, no content. */
	oid?: string;
}

export interface GitRemoteCreateCommitInput {
	branch: string;
	parents: string[];
	expectedBranchHead: string | null;
	updateBranch: boolean;
	message: string;
	author: GitRemoteSignature;
	committer: GitRemoteSignature;
	changes: GitRemoteCommitChange[];
}

export interface GitRemoteHistoryTransport {
	preservesCommitOids: boolean;
	supportsMergeCommits: boolean;
	getHead(
		token: string,
		repositoryId: string,
		branch: string,
	): Promise<string | null>;
	getCommit(
		token: string,
		repositoryId: string,
		oid: string,
	): Promise<GitRemoteCommitObject>;
	/**
	 * The commits reachable from `head`, newest first, a page at a time, up
	 * to `limit`: the listing ends with the first page holding a commit
	 * `known` says is already here. An import asks for a hundred commits at
	 * once this way, instead of one each.
	 */
	listCommits?(
		token: string,
		repositoryId: string,
		head: string,
		options: {
			known?: (oid: string) => Promise<boolean>;
			limit?: number;
		},
	): Promise<GitRemoteCommitObject[]>;
	getTree(
		token: string,
		repositoryId: string,
		commit: GitRemoteCommitObject,
	): Promise<GitRemoteTreeEntry[]>;
	getBlob(
		token: string,
		repositoryId: string,
		oid: string,
	): Promise<Uint8Array>;
	/**
	 * Trees by id, one level each, many at a time (GitHub's GraphQL API:
	 * fifty a request), with the trees under them: each tree once, however
	 * many commits share it. A tree missing from the result could not be
	 * read that way.
	 */
	getTreeLevels?(
		token: string,
		repositoryId: string,
		treeOids: string[],
	): Promise<Map<string, GitRemoteTreeEntry[]>>;
	/**
	 * Text files, many at a time (GitHub's GraphQL API: fifty a request).
	 * Gives those it could read as text; the caller checks each against its
	 * id and fetches the others one by one with getBlob.
	 */
	getTextBlobs?(
		token: string,
		repositoryId: string,
		oids: string[],
	): Promise<Map<string, Uint8Array>>;
	createCommit(
		token: string,
		repositoryId: string,
		input: GitRemoteCreateCommitInput,
	): Promise<GitRemoteCommitObject>;
}

/** A release to make on the provider, at a commit. */
export interface GitRemoteReleaseInput {
	tagName: string;
	name: string;
	body: string;
	/** The commit the tag points to. */
	targetCommitish: string;
	prerelease: boolean;
}

/**
 * Releases, as GitHub's: made as a draft, its files attached, then
 * published (or removed when a file could not be attached).
 */
export interface GitRemoteReleases {
	latestTag(token: string, repositoryId: string): Promise<string | null>;
	tagExists(token: string, repositoryId: string, tag: string): Promise<boolean>;
	createDraft(
		token: string,
		repositoryId: string,
		input: GitRemoteReleaseInput,
	): Promise<{ id: number }>;
	publish(
		token: string,
		repositoryId: string,
		id: number,
	): Promise<{ url: string; tagName: string }>;
	remove(token: string, repositoryId: string, id: number): Promise<void>;
}

/** A pull request, as GitHub's: a branch proposed for merging into another. */
export interface GitRemotePullRequest {
	number: number;
	url: string;
	title: string;
	state: 'open' | 'closed' | 'merged';
	draft: boolean;
	/** The branch it merges into, and the one it proposes. */
	base: string;
	head: string;
}

export interface GitRemotePullRequestInput {
	title: string;
	body: string;
	head: string;
	base: string;
	draft: boolean;
}

export interface GitRemotePullRequests {
	/** The branch pull requests go to unless another is chosen. */
	defaultBranch(token: string, repositoryId: string): Promise<string>;
	/** The latest pull request proposing `branch`, open or not. */
	find(
		token: string,
		repositoryId: string,
		branch: string,
	): Promise<GitRemotePullRequest | null>;
	create(
		token: string,
		repositoryId: string,
		input: GitRemotePullRequestInput,
	): Promise<GitRemotePullRequest>;
}

/**
 * One file of a branch, written on the provider itself: the GitHub Actions
 * workflow, which a token may write only with the « workflow » scope.
 */
export interface GitRemoteWorkflows {
	/** The token's scopes when the provider tells them, else null. */
	tokenScopes(token: string): Promise<string[] | null>;
	readFile(
		token: string,
		repositoryId: string,
		branch: string,
		path: string,
	): Promise<{ sha: string; text: string } | null>;
	writeFile(
		token: string,
		repositoryId: string,
		input: {
			branch: string;
			path: string;
			text: string;
			message: string;
			sha?: string;
		},
	): Promise<void>;
	/** Where the runs are seen. */
	runsUrl(repositoryId: string): string;
}

export interface GitRemoteProvider {
	id: string;
	displayName: string;
	historyPluginId: string;
	historyTokenSecretKey: string;
	backupPluginId: string;
	backupTokenSecretKey: string;
	configure?(getSetting: (id: string) => { value?: unknown } | undefined): void;
	getApiConfiguration?(): GitRemoteApiConfiguration;
	applyApiConfiguration?(configuration: GitRemoteApiConfiguration): void;
	testConnection(token: string): Promise<boolean>;
	listRepositories(token: string): Promise<GitRemoteRepository[]>;
	listBranches(token: string, repositoryId: string): Promise<GitRemoteBranch[]>;
	createBranch?(
		token: string,
		repositoryId: string,
		branch: string,
		sourceRef: string,
	): Promise<void>;
	/** Makes `branch` point at a commit the remote has, by its id. */
	createBranchAtCommit?(
		token: string,
		repositoryId: string,
		branch: string,
		oid: string,
	): Promise<void>;
	normalizeRepositoryInput?(input: string): string;
	getAccount?(token: string): Promise<GitRemoteAccount>;
	/** Whether this token's account sees the repository, and may push to it. */
	repositoryAccess?(
		token: string,
		repositoryId: string,
	): Promise<GitRepositoryAccess>;
	createRepository?(
		token: string,
		input: GitRemoteCreateRepositoryInput,
	): Promise<GitRemoteRepository>;
	getRepositoryUrl?(repositoryId: string, branch?: string): string;
	getTokenCreationUrl?(
		appName: string,
		options?: { workflow?: boolean },
	): string;
	releases?: GitRemoteReleases;
	pullRequests?: GitRemotePullRequests;
	workflows?: GitRemoteWorkflows;
	historyTransport: GitRemoteHistoryTransport;
}
