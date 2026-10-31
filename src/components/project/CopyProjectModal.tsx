// src/components/project/CopyProjectModal.tsx
import type React from 'react';
import { useEffect, useState } from 'react';

import { t } from '@/i18n';
import type { Project } from '../../types/projects';
import Modal from '../common/Modal';

interface CopyProjectModalProps {
	project: Project | null;
	onClose: () => void;
	onCopy: (project: Project, name: string) => Promise<void>;
}

/** Overleaf's "Make a copy": a new project with the same contents. */
const CopyProjectModal: React.FC<CopyProjectModalProps> = ({
	project,
	onClose,
	onCopy,
}) => {
	const [name, setName] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!project) return;
		setName(t('Copy of {name}', { name: project.name }));
		setError(null);
	}, [project]);

	const submit = async (event: React.FormEvent) => {
		event.preventDefault();
		if (!project || !name.trim()) return;
		setBusy(true);
		setError(null);
		try {
			await onCopy(project, name.trim());
		} catch (caught) {
			setError(
				caught instanceof Error
					? caught.message
					: t('Could not copy the project.'),
			);
		} finally {
			setBusy(false);
		}
	};

	return (
		<Modal
			isOpen={!!project}
			onClose={onClose}
			title={t('Copy Project')}
			size='small'
		>
			<form className='ui-stack' data-gap='sm' onSubmit={submit}>
				<label htmlFor='copy-project-name'>{t('New project name')}</label>
				<input
					id='copy-project-name'
					className='ui-field-control'
					type='text'
					value={name}
					onChange={(event) => setName(event.target.value)}
				/>
				<p className='ui-meta'>
					{t(
						'The copy has the documents, comments and files of the project, not its chat, versions, collaborators or GitHub link.',
					)}
				</p>
				{error && (
					<div className='ui-message' data-tone='error'>
						{error}
					</div>
				)}
				<div
					className='ui-actions'
					data-variant='modal'
					data-align='end'
					data-cross='stretch'
					data-fill='true'
				>
					<button
						type='button'
						className='button secondary'
						onClick={onClose}
						disabled={busy}
					>
						{t('Cancel')}
					</button>
					<button
						type='submit'
						className='button primary'
						disabled={busy || !name.trim()}
					>
						{busy ? t('Copying...') : t('Copy')}
					</button>
				</div>
			</form>
		</Modal>
	);
};

export default CopyProjectModal;
