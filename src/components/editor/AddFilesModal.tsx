// src/components/editor/AddFilesModal.tsx
// Adds a file from another project on this device or from a URL, as the
// "From another project" and "From external URL" panes of Overleaf's "Add
// files" dialog.
import type React from 'react';
import { useEffect, useState } from 'react';

import { t } from '@/i18n';
import { accountSyncService } from '../../services/AccountSyncService';
import {
	FileImportError,
	fileImportService,
} from '../../services/FileImportService';
import type { ImportedFileSource } from '../../types/documents';
import type { FileNode } from '../../types/files';
import type { Project } from '../../types/projects';
import {
	fileNameFromUrl,
	fileNameOf,
	isWebAddress,
	outputFileName,
} from '../../utils/fileImportUtils';
import { validateFileName } from '../../utils/fileUtils';
import { FilePlusIcon } from '../common/Icons';
import Modal from '../common/Modal';

export type AddFilesSource = 'project' | 'url';

interface AddFilesModalProps {
	/** The pane to show, or null when the dialog is closed. */
	source: AddFilesSource | null;
	onSourceChange: (source: AddFilesSource) => void;
	onClose: () => void;
	currentProjectId: string;
	folderPath: string;
	/** With where the file came from, so that it can be refreshed. */
	onAdd: (
		file: File,
		folderPath: string,
		source: ImportedFileSource,
	) => Promise<void>;
}

const AddFilesModal: React.FC<AddFilesModalProps> = ({
	source,
	onSourceChange,
	onClose,
	currentProjectId,
	folderPath,
	onAdd,
}) => {
	const [projects, setProjects] = useState<Project[]>([]);
	const [projectId, setProjectId] = useState('');
	const [files, setFiles] = useState<FileNode[] | null>(null);
	const [fileId, setFileId] = useState('');
	// The project's compiled PDF rather than one of its files, as Overleaf's
	// output files.
	const [fromOutput, setFromOutput] = useState(false);
	const [url, setUrl] = useState('');
	const [name, setName] = useState('');
	const [nameEdited, setNameEdited] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const isOpen = source !== null;
	const canCompileOutputs = fileImportService.canCompileOutputs();
	const project = projects.find((entry) => entry.id === projectId);
	const file = files?.find((entry) => entry.id === fileId);

	useEffect(() => {
		if (!isOpen) return;
		setProjectId('');
		setFiles(null);
		setFileId('');
		setFromOutput(false);
		setUrl('');
		setName('');
		setNameEdited(false);
		setError(null);
		setBusy(false);
		let current = true;
		fileImportService
			.listProjects(currentProjectId)
			.then((list) => {
				if (current) setProjects(list);
			})
			.catch(() => {
				if (current) setProjects([]);
			});
		return () => {
			current = false;
		};
	}, [isOpen, currentProjectId]);

	useEffect(() => {
		setFiles(null);
		setFileId('');
		if (!project) return;
		let current = true;
		fileImportService
			.listFiles(project)
			.then((list) => {
				if (current) setFiles(list);
			})
			.catch(() => {
				if (current) setFiles([]);
			});
		return () => {
			current = false;
		};
	}, [project]);

	const suggestedName =
		source === 'url'
			? fileNameFromUrl(url)
			: project && fromOutput
				? outputFileName(project.name)
				: file
					? fileNameOf(file.path)
					: '';
	useEffect(() => {
		if (!nameEdited) setName(suggestedName);
	}, [suggestedName, nameEdited]);

	const switchTo = (next: AddFilesSource) => {
		if (busy || next === source) return;
		setError(null);
		setNameEdited(false);
		onSourceChange(next);
	};

	const chooseKind = (output: boolean) => {
		setFromOutput(output);
		setNameEdited(false);
		setError(null);
	};

	const ready =
		!busy &&
		name.trim() !== '' &&
		(source === 'url'
			? url.trim() !== ''
			: Boolean(project && (fromOutput || file)));

	const submit = async (event: React.FormEvent) => {
		event.preventDefault();
		if (!ready || (source === 'project' && !(project && (fromOutput || file))))
			return;
		const validation = validateFileName(name);
		if (!validation.valid) {
			setError(validation.error ?? null);
			return;
		}
		if (source === 'url' && !isWebAddress(url)) {
			setError(t('Enter a web address that starts with http:// or https://.'));
			return;
		}
		setBusy(true);
		setError(null);
		try {
			const [content, from]: [ArrayBuffer, ImportedFileSource] =
				source === 'project' && project && fromOutput
					? [
							await fileImportService.compileOutput(project),
							fileImportService.outputSource(project),
						]
					: source === 'project' && project && file
						? [
								await fileImportService.readFile(project, file),
								fileImportService.projectSource(project, file),
							]
						: [
								await fileImportService.fetchUrl(url.trim()),
								{ kind: 'url', url: url.trim() },
							];
			await onAdd(new File([content], name.trim()), folderPath, from);
			onClose();
		} catch (caught) {
			setError(
				caught instanceof FileImportError
					? caught.message
					: t('The file could not be added.'),
			);
			setBusy(false);
		}
	};

	const close = () => {
		if (!busy) onClose();
	};

	return (
		<Modal
			isOpen={isOpen}
			onClose={close}
			title={t('Add files')}
			icon={FilePlusIcon}
			size='medium'
		>
			<form
				className='ui-stack add-files-form'
				data-gap='sm'
				data-source={source ?? undefined}
				onSubmit={submit}
			>
				<div className='ui-tab-list' data-variant='switcher' role='tablist'>
					<button
						type='button'
						role='tab'
						aria-selected={source === 'project'}
						className={`ui-tab${source === 'project' ? ' active' : ''}`}
						onClick={() => switchTo('project')}
					>
						{t('From another project')}
					</button>
					<button
						type='button'
						role='tab'
						aria-selected={source === 'url'}
						className={`ui-tab${source === 'url' ? ' active' : ''}`}
						onClick={() => switchTo('url')}
					>
						{t('From external URL')}
					</button>
				</div>

				{source === 'project' && (
					<>
						<label htmlFor='add-file-project'>{t('Select a project')}</label>
						<select
							id='add-file-project'
							className='ui-field-control'
							value={projectId}
							onChange={(event) => setProjectId(event.target.value)}
							disabled={busy}
						>
							<option value=''>
								{projects.length > 0
									? t('Select a project')
									: t('No other project')}
							</option>
							{projects.map((entry) => (
								<option key={entry.id} value={entry.id}>
									{entry.name}
								</option>
							))}
						</select>

						{project && (
							<fieldset
								className='add-files-kind'
								data-role='add-file-kind'
								disabled={busy}
							>
								<label>
									<input
										type='radio'
										name='add-file-kind'
										value='source'
										checked={!fromOutput}
										onChange={() => chooseKind(false)}
									/>
									{t('Source files')}
								</label>
								<label
									title={
										canCompileOutputs
											? undefined
											: t(
													'Taking the PDF of another project needs the TeX Live compile server.',
												)
									}
								>
									<input
										type='radio'
										name='add-file-kind'
										value='output'
										checked={fromOutput}
										disabled={!canCompileOutputs}
										onChange={() => chooseKind(true)}
									/>
									{t('Compiled PDF')}
								</label>
							</fieldset>
						)}

						{project && fromOutput && (
							<p className='ui-meta'>
								{t(
									'The project is compiled now with TeX Live, with its main document and its compiler.',
								)}
							</p>
						)}

						{project && !fromOutput && (
							<>
								<label htmlFor='add-file-source'>{t('Select a file')}</label>
								<select
									id='add-file-source'
									className='ui-field-control'
									value={fileId}
									onChange={(event) => setFileId(event.target.value)}
									disabled={busy || !files?.length}
								>
									<option value=''>
										{files === null ? t('Loading...') : t('Select a file')}
									</option>
									{files?.map((entry) => (
										<option key={entry.id} value={entry.id}>
											{entry.path.replace(/^\//, '')}
										</option>
									))}
								</select>
								{files?.length === 0 && (
									<p className='ui-meta'>
										{t(
											'This project has no files on this device. Open it here once to add its files.',
										)}
									</p>
								)}
							</>
						)}
					</>
				)}

				{source === 'url' && (
					<>
						<label htmlFor='add-file-url'>
							{t('URL to fetch the file from')}
						</label>
						<input
							id='add-file-url'
							type='url'
							className='ui-field-control'
							placeholder='https://'
							value={url}
							onChange={(event) => setUrl(event.target.value)}
							disabled={busy}
							autoComplete='off'
							spellCheck={false}
						/>
						{!accountSyncService.isLinked() && (
							<p className='ui-meta'>
								{t(
									'Without a server account, only sites that let web pages download their files work.',
								)}
							</p>
						)}
					</>
				)}

				<label htmlFor='add-file-name'>{t('File name in this project')}</label>
				<input
					id='add-file-name'
					type='text'
					className='ui-field-control'
					value={name}
					onChange={(event) => {
						setName(event.target.value);
						setNameEdited(true);
					}}
					disabled={busy}
					autoComplete='off'
					spellCheck={false}
				/>
				{folderPath !== '/' && (
					<p className='ui-meta'>
						{t('In the folder {folder}', {
							folder: folderPath.replace(/^\//, ''),
						})}
					</p>
				)}

				{error && (
					<div className='ui-message' data-tone='error' role='alert'>
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
						onClick={close}
						disabled={busy}
					>
						{t('Cancel')}
					</button>
					<button
						type='submit'
						className='button primary'
						disabled={!ready}
						aria-busy={busy}
					>
						{busy
							? fromOutput && source === 'project'
								? t('Compiling...')
								: t('Adding...')
							: t('Create')}
					</button>
				</div>
			</form>
		</Modal>
	);
};

export default AddFilesModal;
