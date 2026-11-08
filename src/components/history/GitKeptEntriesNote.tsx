// src/components/history/GitKeptEntriesNote.tsx
// What the repository has that the project does not show: submodules,
// symbolic links, files kept with Git LFS. Feuillet keeps them as they are
// on the remote; this says which, so an empty folder or a broken image is
// not a surprise.
import type React from 'react';

import { APP_NAME } from '@/branding';
import { t } from '@/i18n';
import type { GitKeptEntries } from '@/services/GitService';

interface GitKeptEntriesNoteProps {
	kept: GitKeptEntries | null;
	remoteName: string;
}

const GitKeptEntriesNote: React.FC<GitKeptEntriesNoteProps> = ({
	kept,
	remoteName,
}) => {
	if (!kept) return null;
	const count = kept.submodules.length + kept.links.length + kept.lfs.length;
	if (count === 0) return null;
	return (
		<details className='github-sync-clone' data-role='kept-entries'>
			<summary>
				{t('On {provider}, not in the project', { provider: remoteName })}{' '}
				<span className='ui-badge' data-variant='label'>
					{count}
				</span>
			</summary>
			<ul className='ui-meta github-sync-kept'>
				{kept.submodules.map(({ path, commit }) => (
					<li key={`submodule:${path}`} data-kind='submodule'>
						{t(
							'{path}: a submodule, at commit {commit}. Its files are not in the project, so a compile here does not have them.',
							{ path, commit: commit.slice(0, 7) },
						)}
					</li>
				))}
				{kept.lfs.map((path) => (
					<li key={`lfs:${path}`} data-kind='lfs'>
						{t(
							'{path}: kept with Git LFS. The project has only its pointer, a few lines of text; a file put in its place here is pushed without LFS.',
							{ path },
						)}
					</li>
				))}
				{kept.links.map(({ path, target }) => (
					<li key={`link:${path}`} data-kind='link'>
						{t('{path}: a symbolic link to {target}.', { path, target })}
					</li>
				))}
			</ul>
			<p className='ui-meta'>
				{t('Pushes from {app} leave them as they are on {provider}.', {
					app: APP_NAME,
					provider: remoteName,
				})}
			</p>
		</details>
	);
};

export default GitKeptEntriesNote;
