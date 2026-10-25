// src/components/history/GitRepositoryPicker.tsx
import type React from 'react';
import { useEffect, useRef, useState } from 'react';

import { t } from '@/i18n';
import type {
	GitRemoteBranch,
	GitRemoteProvider,
	GitRemoteRepository,
} from '@/types/gitRemote';

export interface GitRepositorySelection {
	repository: GitRemoteRepository;
	branch: string;
	branches: GitRemoteBranch[];
}

interface GitRepositoryPickerProps {
	provider: GitRemoteProvider;
	readToken: () => Promise<string>;
	disabled: boolean;
	onChange: (selection: GitRepositorySelection | null) => void;
	onError: (message: string) => void;
}

const pickDefaultBranch = (
	branches: GitRemoteBranch[],
	repository: GitRemoteRepository,
): string =>
	branches.find((item) => item.name === repository.defaultBranch)?.name ??
	branches.find((item) => item.name === 'main')?.name ??
	branches.find((item) => item.name === 'master')?.name ??
	branches[0]?.name ??
	repository.defaultBranch ??
	'main';

const GitRepositoryPicker: React.FC<GitRepositoryPickerProps> = ({
	provider,
	readToken,
	disabled,
	onChange,
	onError,
}) => {
	const [repositories, setRepositories] = useState<GitRemoteRepository[]>([]);
	const [query, setQuery] = useState('');
	const [repository, setRepository] = useState<GitRemoteRepository | null>(
		null,
	);
	const [branches, setBranches] = useState<GitRemoteBranch[]>([]);
	const [branch, setBranch] = useState('');
	const [loading, setLoading] = useState<'repositories' | 'branches' | null>(
		null,
	);
	const loadedRef = useRef(false);

	const report = (error: unknown) =>
		onError(error instanceof Error ? error.message : t('Git action failed'));

	/* biome-ignore lint/correctness/useExhaustiveDependencies: The repository list is loaded once per picker. */
	useEffect(() => {
		if (loadedRef.current) return;
		loadedRef.current = true;
		setLoading('repositories');
		readToken()
			.then((token) => provider.listRepositories(token))
			.then(setRepositories)
			.catch(report)
			.finally(() => setLoading(null));
	}, [provider]);

	const choose = async (next: GitRemoteRepository) => {
		setRepository(next);
		setQuery(next.label);
		setBranches([]);
		setBranch('');
		onChange(null);
		setLoading('branches');
		try {
			const loaded = await provider.listBranches(await readToken(), next.id);
			const preferred = pickDefaultBranch(loaded, next);
			setBranches(loaded);
			setBranch(preferred);
			onChange({ repository: next, branch: preferred, branches: loaded });
		} catch (error) {
			setRepository(null);
			report(error);
		} finally {
			setLoading(null);
		}
	};

	const normalizedQuery = provider.normalizeRepositoryInput
		? provider.normalizeRepositoryInput(query)
		: query.trim();
	const filtered = repositories.filter((item) =>
		item.label.toLowerCase().includes(query.trim().toLowerCase()),
	);
	const isDisabled = disabled || loading !== null;

	return (
		<div className='git-repository-picker ui-stack' data-gap='sm'>
			<label className='ui-field-label' htmlFor='git-repository-search'>
				{t('Repository')}
			</label>
			<input
				id='git-repository-search'
				type='text'
				value={query}
				disabled={disabled}
				placeholder={t('Search your repositories or paste owner/name or a URL')}
				onChange={(event) => {
					setQuery(event.target.value);
					setRepository(null);
					setBranches([]);
					setBranch('');
					onChange(null);
				}}
			/>
			{loading === 'repositories' ? (
				<p className='ui-note'>{t('Loading repositories...')}</p>
			) : null}
			{repositories.length > 0 && !repository ? (
				<select
					aria-label={t('Repository')}
					size={Math.min(8, Math.max(3, filtered.length))}
					value=''
					disabled={isDisabled}
					onChange={(event) => {
						const selected = repositories.find(
							(item) => item.id === event.target.value,
						);
						if (selected) void choose(selected);
					}}
				>
					{filtered.map((item) => (
						<option key={item.id} value={item.id}>
							{item.label}
							{item.private ? ` (${t('private')})` : ''}
						</option>
					))}
				</select>
			) : null}
			{!repository &&
			normalizedQuery.includes('/') &&
			!filtered.some((item) => item.id === normalizedQuery) ? (
				<button
					type='button'
					className='button secondary'
					disabled={isDisabled}
					onClick={() =>
						void choose({ id: normalizedQuery, label: normalizedQuery })
					}
				>
					{t('Use {repository}', { repository: normalizedQuery })}
				</button>
			) : null}
			{loading === 'branches' ? (
				<p className='ui-note'>{t('Loading branches...')}</p>
			) : null}
			{repository && loading !== 'branches' ? (
				<>
					<label className='ui-field-label' htmlFor='git-repository-branch'>
						{t('Branch')}
					</label>
					<input
						id='git-repository-branch'
						type='text'
						list='git-repository-branches'
						value={branch}
						disabled={disabled}
						onChange={(event) => {
							setBranch(event.target.value);
							onChange(
								event.target.value.trim()
									? {
											repository,
											branch: event.target.value.trim(),
											branches,
										}
									: null,
							);
						}}
					/>
					<datalist id='git-repository-branches'>
						{branches.map((item) => (
							<option key={item.name} value={item.name} />
						))}
					</datalist>
					{branches.length > 0 &&
					!branches.some((item) => item.name === branch.trim()) ? (
						<p className='ui-note'>
							{t('A new remote branch will be created when you connect.')}
						</p>
					) : null}
				</>
			) : null}
		</div>
	);
};

export default GitRepositoryPicker;
