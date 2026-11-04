// src/components/output/OutputFilesMenu.tsx
// Overleaf's « Other logs and files », under the log: the files the last
// compile wrote on the TeX Live server (the .bbl arXiv asks for, the whole
// .log, the .aux...), each downloaded when chosen.
import type React from 'react';
import { useEffect, useRef, useState } from 'react';

import { t } from '@/i18n';
import type { OutputFileEntry } from '../../utils/compilerUtils';
import { formatFileSize } from '../../utils/fileUtils';
import { ChevronDownIcon } from '../common/Icons';
import PositionedDropdown from '../common/PositionedDropdown';

interface OutputFilesMenuProps {
	files: OutputFileEntry[];
	onDownload: (path: string) => Promise<boolean>;
}

const sizeOf = (size: number): string =>
	size === 0 ? t('{count} bytes', { count: 0 }) : formatFileSize(size);

const OutputFilesMenu: React.FC<OutputFilesMenuProps> = ({
	files,
	onDownload,
}) => {
	const [isOpen, setIsOpen] = useState(false);
	const [downloading, setDownloading] = useState<string | null>(null);
	const [problem, setProblem] = useState<{
		path: string;
		kind: 'gone' | 'failed';
	} | null>(null);
	const buttonRef = useRef<HTMLButtonElement>(null);

	// A new compile, new files.
	useEffect(() => {
		setProblem(null);
		if (files.length === 0) setIsOpen(false);
	}, [files]);

	if (files.length === 0) return null;

	const download = async (path: string) => {
		setDownloading(path);
		setProblem(null);
		try {
			if (!(await onDownload(path))) setProblem({ path, kind: 'gone' });
		} catch {
			setProblem({ path, kind: 'failed' });
		} finally {
			setDownloading(null);
			// Out of the way of the file, or of why it did not come.
			setIsOpen(false);
		}
	};

	const name = problem?.path.split('/').pop() ?? '';

	return (
		<div className='output-files-bar' data-role='output-files'>
			{problem && (
				<span
					className='output-files-problem'
					data-role='output-file-problem'
					role='status'
				>
					{problem.kind === 'gone'
						? t(
								'{name} is no longer on the compile server: compile again to get it.',
								{ name },
							)
						: t('{name} could not be downloaded.', { name })}
				</span>
			)}
			<button
				ref={buttonRef}
				type='button'
				className='button secondary'
				data-action='open-output-files'
				aria-expanded={isOpen}
				aria-haspopup='menu'
				onClick={() => setIsOpen((open) => !open)}
			>
				{t('Other logs and files')}
				<ChevronDownIcon />
			</button>
			<PositionedDropdown
				isOpen={isOpen}
				triggerElement={buttonRef.current}
				onClose={() => setIsOpen(false)}
				className='output-files-menu'
			>
				<div className='ui-menu-section' role='menu'>
					<div className='ui-menu-title'>
						{t('Files the last compile wrote')}
					</div>
					{files.map((file) => (
						<button
							key={file.path}
							type='button'
							role='menuitem'
							className='ui-menu-item'
							data-density='compact'
							data-action='download-output-file'
							data-path={file.path}
							disabled={downloading !== null}
							title={t('Download {name}', { name: file.path })}
							onClick={() => void download(file.path)}
						>
							<span className='ui-menu-label'>
								{downloading === file.path
									? t('Downloading {name}…', { name: file.path })
									: file.path}
							</span>
							<span className='ui-menu-meta'>{sizeOf(file.size)}</span>
						</button>
					))}
				</div>
			</PositionedDropdown>
		</div>
	);
};

export default OutputFilesMenu;
