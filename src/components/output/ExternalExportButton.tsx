// src/components/output/ExternalExportButton.tsx
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { t } from '@/i18n';
import PositionedDropdown from '../common/PositionedDropdown';
import { useExternalTypesetter } from '../../hooks/useExternalTypesetter';
import { useFileTree } from '../../hooks/useFileTree';
import { useProjectCompileSettings } from '../../hooks/useProjectCompileSettings';
import { useProperties } from '../../hooks/useProperties';
import { fileStoreService } from '../../services/FileStoreService';
import type {
	TypesetterProvider,
	TypesetterUIField,
	TranslatableText,
} from '../../types/compilation';
import {
	ChevronDownIcon,
	ExportIcon,
	GlobeIcon,
	OptionsIcon,
} from '../common/Icons';
import type { ArxivPackage, ArxivWarning } from '../../utils/arxivPackage';
import { getFilenameFromPath } from '../../utils/fileUtils';
import { optionsWith } from '../../utils/projectCompileSettings';
import { TEXLIVE_TYPESETTER_ID } from '../../utils/texliveTypesetter';
import {
	chooseLatexMainFile,
	collectValues,
	fieldDefault,
	findInputFiles,
	resolveLabel,
} from '../../utils/compilerUtils';

interface ExternalExportButtonProps {
	provider: TypesetterProvider;
	className?: string;
	linkedFileInfo?: {
		fileName?: string;
		filePath?: string;
	} | null;
}

const LOG_FIELD_KEY = 'includeLog';

// What arXiv may refuse or compile otherwise.
const arxivWarningText = (warning: ArxivWarning, year: number): string => {
	switch (warning) {
		case 'lualatex':
			return t(
				'arXiv does not compile with LuaLaTeX: choose pdfLaTeX or XeLaTeX as the compiler.',
			);
		case 'not-at-root':
			return t(
				'arXiv compiles from the root of the archive: put the main document at the root of the project.',
			);
		case 'no-bbl':
			return t(
				'The compile made no .bbl, and arXiv runs neither BibTeX nor Biber: check the log.',
			);
		case 'biblatex-format':
			return t(
				'The .bbl of biblatex is not in the format of the TeX Live arXiv offers: arXiv may refuse it. Choose TeX Live {year} (arXiv) as the TeX Live version, then export again.',
				{ year: String(year) },
			);
		case 'compile-errors':
			return t(
				'The compile had errors: arXiv may not compile the archive either.',
			);
	}
};

const ExternalExportButton: React.FC<ExternalExportButtonProps> = ({
	provider,
	className = '',
	linkedFileInfo,
}) => {
	const { isCompiling, isExporting, exportDocument, exportArxivPackage } =
		useExternalTypesetter();
	const [arxivMade, setArxivMade] = useState<
		(ArxivPackage & { fileName: string }) | null
	>(null);
	const [arxivBusy, setArxivBusy] = useState(false);
	// arXiv needs the files TeX Live writes, which this server gives.
	const offersArxiv = provider.id === TEXLIVE_TYPESETTER_ID;
	const { selectedFileId, getFile, fileTree } = useFileTree();
	const { getProperty, setProperty, registerProperty } = useProperties();
	const [isDropdownOpen, setIsDropdownOpen] = useState(false);
	const [isGroupOpen, setIsGroupOpen] = useState(false);
	const [autoMainFile, setAutoMainFile] = useState<string | undefined>();
	const dropdownRef = useRef<HTMLDivElement>(null);
	const propertiesRegistered = useRef(false);

	const projectId = fileStoreService.getCurrentProjectId() || undefined;
	const section = provider.ui?.export;
	const fields = section?.fields ?? [];
	const settings = useProjectCompileSettings(provider);
	const fieldPropertyId = useCallback(
		(key: string) => `external-export-${provider.id}-${key}`,
		[provider.id],
	);

	const availableFiles = useMemo(
		() => findInputFiles(fileTree, provider.inputExtensions),
		[fileTree, provider.inputExtensions],
	);

	/* biome-ignore lint/correctness/useExhaustiveDependencies: One-time registration guarded by ref; fields and provider metadata are read for initial registration only. */
	useEffect(() => {
		if (propertiesRegistered.current) return;
		propertiesRegistered.current = true;

		for (const field of fields) {
			if (field.shared) continue;
			registerProperty({
				id: fieldPropertyId(field.key),
				category: 'Export',
				subcategory: provider.label,
				defaultValue: fieldDefault(field),
			});
		}
	}, [registerProperty]);

	// As for compiling: a LaTeX part exports the document that includes it.
	useEffect(() => {
		let current = true;
		const resolveAuto = async () => {
			let candidate: string | undefined;
			if (
				linkedFileInfo?.filePath &&
				availableFiles.includes(linkedFileInfo.filePath)
			) {
				candidate = linkedFileInfo.filePath;
			} else if (selectedFileId) {
				const file = await getFile(selectedFileId);
				if (file && availableFiles.includes(file.path)) candidate = file.path;
			}
			const path = provider.inputExtensions.includes('tex')
				? await chooseLatexMainFile(
						candidate,
						undefined,
						availableFiles,
						(file) => fileStoreService.isRootLatexFile(file),
					)
				: (candidate ?? availableFiles[0]);
			if (current) setAutoMainFile(path);
		};
		resolveAuto();
		return () => {
			current = false;
		};
	}, [
		selectedFileId,
		getFile,
		availableFiles,
		linkedFileInfo,
		provider.inputExtensions,
	]);

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			const target = event.target as Node;
			if (dropdownRef.current && !dropdownRef.current.contains(target)) {
				const portaled = document.querySelector('.external-dropdown');
				if (portaled?.contains(target)) return;
				setIsDropdownOpen(false);
			}
		};
		document.addEventListener('mousedown', handleClickOutside);
		return () => document.removeEventListener('mousedown', handleClickOutside);
	}, []);

	const projectMainFile =
		settings.mainFile && availableFiles.includes(settings.mainFile)
			? settings.mainFile
			: undefined;
	const effectiveMainFile = projectMainFile || autoMainFile;

	// The project's compiler is set where it compiles; exports follow it.
	const readValue = useCallback(
		(key: string): unknown =>
			settings.isShared(key)
				? settings.readShared(key)
				: getProperty(fieldPropertyId(key), { scope: 'project', projectId }),
		[settings, getProperty, projectId, fieldPropertyId],
	);

	const writeValue = useCallback(
		(key: string, value: string | number | boolean) => {
			setProperty(fieldPropertyId(key), value, { scope: 'project', projectId });
		},
		[setProperty, projectId, fieldPropertyId],
	);

	const handleExport = useCallback(async () => {
		if (!effectiveMainFile) return;
		const { format, options } = collectValues(fields, readValue);
		const resolvedFormat = format ?? provider.outputFormats[0]?.id ?? 'pdf';
		const includeLog = options[LOG_FIELD_KEY] === true;
		delete options[LOG_FIELD_KEY];

		await exportDocument(provider.id, effectiveMainFile, resolvedFormat, {
			includeLog,
			options,
		});
		setIsDropdownOpen(false);
	}, [effectiveMainFile, fields, readValue, provider, exportDocument]);

	const handleArxiv = useCallback(async () => {
		if (!effectiveMainFile) return;
		setArxivMade(null);
		setArxivBusy(true);
		const { options } = collectValues(fields, readValue);
		delete options[LOG_FIELD_KEY];
		try {
			setArxivMade(
				await exportArxivPackage(provider.id, effectiveMainFile, options),
			);
		} finally {
			setArxivBusy(false);
		}
	}, [effectiveMainFile, fields, readValue, provider.id, exportArxivPackage]);

	const toggleDropdown = (e: React.MouseEvent) => {
		e.stopPropagation();
		setArxivMade(null);
		setIsDropdownOpen(!isDropdownOpen);
	};

	const exportLabel = resolveLabel(section?.label) || t('Export');
	const isDisabled = isCompiling || isExporting || !effectiveMainFile;

	const isFieldVisible = useCallback(
		(field: TypesetterUIField): boolean => {
			if (!field.showWhen) return true;
			const dep = fields.find((f) => f.key === field.showWhen?.field);
			if (!dep) return true;
			const stored = readValue(dep.key);
			const resolved =
				stored === undefined || stored === null || stored === ''
					? fieldDefault(dep)
					: stored;
			return field.showWhen.in.includes(String(resolved));
		},
		[fields, readValue],
	);

	const visibleFields = fields.filter(isFieldVisible);
	const ungroupedFields = visibleFields.filter((f) => !f.group);
	const groupKey = visibleFields.find((f) => f.group)?.group;
	const groupedFields = groupKey
		? visibleFields.filter((f) => f.group === groupKey)
		: [];
	const groupLabel: TranslatableText = groupKey
		? `${groupKey.toUpperCase()} Options`
		: 'Options';

	const renderField = (field: TypesetterUIField) => {
		const stored = readValue(field.key);
		const value = stored === undefined ? fieldDefault(field) : stored;

		if (field.shared) {
			const option = optionsWith(field, value).find(
				(entry) => entry.value === value,
			);
			return (
				<div className='ui-menu-section' data-variant='control' key={field.key}>
					<div className='ui-menu-title' data-variant='control'>
						{resolveLabel(field.label)}
					</div>
					<div
						className='ui-menu-value'
						title={t('Kept with the project, for every collaborator')}
						data-field={field.key}
					>
						{option ? resolveLabel(option.label) : String(value)}
					</div>
				</div>
			);
		}

		if (field.kind === 'boolean') {
			return (
				<label className='ui-menu-item checkbox-control' key={field.key}>
					<input
						type='checkbox'
						checked={value === true}
						onChange={(e) => writeValue(field.key, e.target.checked)}
						disabled={isExporting}
					/>
					{resolveLabel(field.label)}
				</label>
			);
		}

		if (field.kind === 'select') {
			return (
				<div className='ui-menu-section' data-variant='control' key={field.key}>
					<div className='ui-menu-title' data-variant='control'>
						{resolveLabel(field.label)}
					</div>
					<select
						value={String(value)}
						onChange={(e) => writeValue(field.key, e.target.value)}
						className='ui-field-control'
						disabled={isExporting}
					>
						{(field.options ?? []).map((option) => (
							<option key={option.value} value={option.value}>
								{resolveLabel(option.label)}
							</option>
						))}
					</select>
				</div>
			);
		}

		return (
			<div className='ui-menu-section' data-variant='control' key={field.key}>
				<div className='ui-menu-title' data-variant='control'>
					{resolveLabel(field.label)}
				</div>
				<input
					type={field.kind === 'number' ? 'number' : 'text'}
					value={String(value)}
					onChange={(e) =>
						writeValue(
							field.key,
							field.kind === 'number' ? Number(e.target.value) : e.target.value,
						)
					}
					className='ui-field-control'
					disabled={isExporting}
				/>
			</div>
		);
	};

	return (
		<div className={`ui-control-cluster ${className}`} ref={dropdownRef}>
			<div
				className='ui-button-group ui-split-button'
				data-variant='joined'
				data-size='control'
				data-trigger-group='true'
			>
				<button
					type='button'
					className={`ui-split-main export-button ${isExporting ? 'exporting' : ''}`}
					onClick={handleExport}
					disabled={isDisabled}
					title={exportLabel}
				>
					<ExportIcon />
				</button>

				<button
					type='button'
					className='ui-split-toggle dropdown-toggle'
					onClick={toggleDropdown}
					title={t('Export Options')}
				>
					<ChevronDownIcon />
					<span className='external-button-status' aria-hidden='true'>
						<GlobeIcon />
					</span>
				</button>
			</div>

			<PositionedDropdown
				isOpen={isDropdownOpen}
				triggerElement={
					dropdownRef.current?.querySelector(
						'[data-trigger-group]',
					) as HTMLElement
				}
				className='external-dropdown'
			>
				<div className='ui-menu-section' data-variant='control'>
					<div className='ui-menu-title' data-variant='control'>
						{t('Main File:')}
					</div>
					<div className='ui-menu-value' title={effectiveMainFile}>
						{getFilenameFromPath(effectiveMainFile, '.tex') ||
							t('No input file')}
					</div>
				</div>

				{(ungroupedFields.length > 0 || groupedFields.length > 0) && (
					<div className='ui-menu-section' data-variant='control'>
						{ungroupedFields.map(renderField)}
						{groupedFields.length > 0 && (
							<div className='ui-toolbar' data-justify='between' data-gap='sm'>
								<div className='ui-menu-title' data-variant='control'>
									{resolveLabel(groupLabel)}
								</div>
								<button
									type='button'
									className={`ui-icon-button ${isGroupOpen ? 'active' : ''}`}
									data-variant='control'
									onClick={() => setIsGroupOpen(!isGroupOpen)}
									title={t('Options')}
									disabled={isExporting}
								>
									<OptionsIcon />
								</button>
							</div>
						)}
						{groupedFields.length > 0 && isGroupOpen && (
							<div
								className='ui-card ui-stack'
								data-surface='secondary'
								data-padding='sm'
								data-gap='sm'
							>
								{groupedFields.map((field) => (
									<div className='ui-field' key={field.key}>
										{renderField(field)}
									</div>
								))}
							</div>
						)}
					</div>
				)}

				<div className='ui-menu-section' data-variant='control'>
					<button
						type='button'
						className='button primary'
						onClick={handleExport}
						disabled={isDisabled}
					>
						<ExportIcon />
						{exportLabel}
					</button>
					{offersArxiv && (
						<button
							type='button'
							className='button secondary'
							data-action='export-arxiv'
							onClick={() => void handleArxiv()}
							disabled={isDisabled}
							title={t(
								'The sources with the .bbl and a 00README.json, as arXiv takes them',
							)}
						>
							<ExportIcon />
							{arxivBusy ? t('Exporting...') : t('Package for arXiv (.zip)')}
						</button>
					)}
				</div>

				{arxivMade && (
					<div
						className='ui-menu-section arxiv-made'
						data-variant='control'
						data-role='arxiv-made'
						role='status'
					>
						<div>
							{t(
								'{name} downloaded: {files} files, for {compiler} and TeX Live {year}.',
								{
									name: arxivMade.fileName,
									files: arxivMade.files.length,
									compiler:
										arxivMade.compiler === 'xelatex'
											? 'XeLaTeX'
											: arxivMade.compiler === 'pdflatex'
												? 'pdfLaTeX'
												: arxivMade.compiler === 'latex'
													? 'LaTeX'
													: 'LuaLaTeX',
									year: arxivMade.texLiveVersion,
								},
							)}
						</div>
						{arxivMade.warnings.length > 0 && (
							<ul data-role='arxiv-warnings'>
								{arxivMade.warnings.map((warning) => (
									<li key={warning} data-warning={warning}>
										{arxivWarningText(warning, arxivMade.texLiveVersion)}
									</li>
								))}
							</ul>
						)}
					</div>
				)}
			</PositionedDropdown>
		</div>
	);
};

export default ExternalExportButton;
