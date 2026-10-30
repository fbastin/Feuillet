// src/components/output/ExternalTypesetterOutput.tsx
import type React from 'react';
import {
	createElement,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';

import { t } from '@/i18n';
import { createNamedLogger } from '@/logging';
import { fileStoreService } from '../../services/FileStoreService';
import { filePathCacheService } from '../../services/FilePathCacheService';
import { useExternalTypesetter } from '../../hooks/useExternalTypesetter';
import { useWheelScroll } from '../../hooks/useWheelScroll';
import { useFileTree } from '../../hooks/useFileTree';
import { useProperties } from '../../hooks/useProperties';
import { useSourceMap } from '../../hooks/useSourceMap';
import { pluginRegistry } from '../../plugins/PluginRegistry';
import type { RendererController } from '../../plugins/PluginInterface';
import type { TypesetterProvider } from '../../types/compilation';
import type { SourceMapClickMode } from '../../types/sourceMap';
import { toArrayBuffer } from '../../utils/fileUtils';
import { gotoEditor } from '../../utils/editorNavigator';
import ResizablePanel from '../common/ResizablePanel';
import ExternalCompileButton from './ExternalCompileButton';
import SourceMapFloatingButton from './SourceMapFloatingButton';
import {
	chooseLatexMainFile,
	findInputFiles,
	outputExtension,
	resolveLabel,
} from '../../utils/compilerUtils';

const moduleLog = createNamedLogger('ExternalTypesetterOutput');

interface ExternalTypesetterOutputProps {
	provider: TypesetterProvider;
	className?: string;
	selectedDocId?: string | null;
	onExpandExternalOutput?: () => void;
	linkedFileInfo?: {
		fileName?: string;
		filePath?: string;
	} | null;
}

const indicatorColor: Record<string, string> = {
	idle: '#777',
	success: '#28a745',
	warn: '#ffc107',
	error: '#dc3545',
};

const ExternalTypesetterOutput: React.FC<ExternalTypesetterOutputProps> = ({
	provider,
	className = '',
	selectedDocId,
	onExpandExternalOutput,
	linkedFileInfo,
}) => {
	const {
		compileError,
		compileLog,
		compiledOutput,
		outputMimeType,
		outputFormat,
		currentView,
		logIndicator,
		toggleOutputView,
		compileDocument,
	} = useExternalTypesetter();

	const projectId = fileStoreService.getCurrentProjectId() || undefined;
	const { fileTree, selectedFileId, getFile } = useFileTree();
	const { getProperty, setProperty, registerProperty } = useProperties();
	const {
		reverseSync,
		currentHighlight,
		isAvailable: sourceMapAvailable,
		reverseClickEnabled,
		reverseClickMode,
	} = useSourceMap();

	const rendererControllerRef = useRef<RendererController | null>(null);
	const clickCountRef = useRef(0);
	const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const outputTabsRef = useWheelScroll<HTMLDivElement>();

	// Same error list as the built-in compilers, for logs in their format.
	const loggerPlugin = pluginRegistry.getLoggerForType(provider.projectType);
	// Counted on the log tab, as on Overleaf: the errors, or else the
	// warnings, of the last compile, whose PDF may be shown despite them.
	const logCounts = useMemo(() => {
		const entries = loggerPlugin?.parseDiagnostics?.(compileLog) ?? [];
		return {
			errors: entries.filter((entry) => entry.type === 'error').length,
			warnings: entries.filter((entry) => entry.type === 'warning').length,
		};
	}, [loggerPlugin, compileLog]);
	const [visualizerHeight, setVisualizerHeight] = useState(300);
	const [visualizerCollapsed, setVisualizerCollapsed] = useState(false);

	useEffect(() => {
		registerProperty({
			id: 'log-visualizer-height',
			category: 'UI',
			subcategory: 'Layout',
			defaultValue: 300,
		});
		registerProperty({
			id: 'log-visualizer-collapsed',
			category: 'UI',
			subcategory: 'Layout',
			defaultValue: false,
		});
	}, [registerProperty]);

	useEffect(() => {
		const storedHeight = getProperty('log-visualizer-height');
		const storedCollapsed = getProperty('log-visualizer-collapsed');
		if (storedHeight !== undefined) setVisualizerHeight(Number(storedHeight));
		if (storedCollapsed !== undefined) {
			setVisualizerCollapsed(Boolean(storedCollapsed));
		}
	}, [getProperty]);

	const handleVisualizerResize = (height: number) => {
		setVisualizerHeight(height);
		setProperty('log-visualizer-height', height);
	};

	const handleVisualizerCollapse = (collapsed: boolean) => {
		setVisualizerCollapsed(collapsed);
		setProperty('log-visualizer-collapsed', collapsed);
	};

	const tabs = useMemo(() => {
		if (provider.ui?.renderers?.length) {
			return provider.ui.renderers.map((renderer) => ({
				format: renderer.format,
				label: resolveLabel(renderer.label),
			}));
		}
		return provider.outputFormats.map((format) => ({
			format: format.id,
			label: format.id.toUpperCase(),
		}));
	}, [provider.ui?.renderers, provider.outputFormats]);

	const formatField = useMemo(
		() => provider.ui?.compile?.fields?.find((f) => f.sendAs === 'format'),
		[provider.ui?.compile?.fields],
	);
	const formatPropertyId = formatField
		? `external-${provider.id}-${formatField.key}`
		: undefined;

	const propFormat = formatPropertyId
		? (getProperty(formatPropertyId, { scope: 'project', projectId }) as
				| string
				| undefined)
		: undefined;

	const effectiveFormat = propFormat || outputFormat || tabs[0]?.format;

	useEffect(() => {
		rendererControllerRef.current?.setHighlight?.(currentHighlight);
	}, [currentHighlight]);

	useEffect(() => {
		return () => {
			if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
		};
	}, []);

	const sharedContent = useMemo(
		() => (compiledOutput ? toArrayBuffer(compiledOutput) : null),
		[compiledOutput],
	);

	const resolveCompileTarget = useCallback(async (): Promise<
		string | undefined
	> => {
		const matches = findInputFiles(fileTree, provider.inputExtensions);
		let candidate: string | undefined;
		if (linkedFileInfo?.filePath && matches.includes(linkedFileInfo.filePath)) {
			candidate = linkedFileInfo.filePath;
		} else if (selectedFileId) {
			const file = await getFile(selectedFileId);
			if (file && matches.includes(file.path)) candidate = file.path;
		}
		// A LaTeX part compiles the document that includes it.
		if (!provider.inputExtensions.includes('tex')) {
			return candidate ?? matches[0];
		}
		return chooseLatexMainFile(candidate, undefined, matches, (path) =>
			fileStoreService.isRootLatexFile(path),
		);
	}, [
		fileTree,
		provider.inputExtensions,
		linkedFileInfo,
		selectedFileId,
		getFile,
	]);

	const handleLineClick = async (line: number, filePath?: string) => {
		try {
			const mainFile = await resolveCompileTarget();
			const targetFile = filePath
				? await filePathCacheService.findFileByPath(mainFile ?? '', filePath)
				: null;
			if (!targetFile) {
				if (filePath) moduleLog.warn(`Diagnostic file not found: ${filePath}`);
				if (selectedFileId) {
					gotoEditor({ kind: 'file', fileId: selectedFileId }, { line });
				}
				return;
			}

			const target = targetFile.documentId
				? { kind: 'document' as const, documentId: targetFile.documentId }
				: { kind: 'file' as const, fileId: targetFile.id };
			const isCurrent = targetFile.documentId
				? selectedDocId === targetFile.documentId
				: selectedFileId === targetFile.id;

			if (isCurrent) {
				gotoEditor(target, { line });
			} else {
				gotoEditor(target, { line }, { waitForReady: true });
				document.dispatchEvent(
					new CustomEvent('navigate-to-compiled-file', {
						detail: { filePath: targetFile.path },
					}),
				);
			}
		} catch (error) {
			moduleLog.error('Error handling line click:', error);
		}
	};

	const handleTabSwitch = useCallback(
		async (format: string) => {
			if (effectiveFormat === format) return;

			if (formatPropertyId) {
				setProperty(formatPropertyId, format, {
					scope: 'project',
					projectId,
				});
			}

			const mainFile = await resolveCompileTarget();

			if (mainFile) {
				await compileDocument(provider.id, mainFile, format);
			}
		},
		[
			effectiveFormat,
			formatPropertyId,
			setProperty,
			projectId,
			resolveCompileTarget,
			compileDocument,
			provider.id,
		],
	);

	const handleLocationClick = useCallback(
		(page: number, x: number, y: number) => {
			if (!reverseClickEnabled) return;

			clickCountRef.current++;

			if (clickTimerRef.current) clearTimeout(clickTimerRef.current);

			clickTimerRef.current = setTimeout(() => {
				const required: Record<SourceMapClickMode, number> = {
					single: 1,
					double: 2,
					triple: 3,
				};

				if (clickCountRef.current >= required[reverseClickMode]) {
					reverseSync(page, x, y);
				}

				clickCountRef.current = 0;
			}, 300);
		},
		[reverseClickEnabled, reverseClickMode, reverseSync],
	);

	const outputViewerContent = useMemo(() => {
		if (!compiledOutput) return null;

		const format = provider.outputFormats.find((f) => f.id === effectiveFormat);
		const renderer = pluginRegistry.getRendererForOutput(
			format?.outputType ?? effectiveFormat ?? '',
			format?.rendererPluginId,
		);
		const mimeType = outputMimeType ?? format?.mimeType;

		return (
			<div className='pdf-viewer'>
				{renderer ? (
					createElement(renderer.renderOutput, {
						content: sharedContent ?? new ArrayBuffer(0),
						mimeType,
						fileName: `output.${outputExtension(mimeType, effectiveFormat ?? '')}`,
						onLocationClick: handleLocationClick,
						memoryOptimized: true,
						controllerRef: (controller: RendererController | null) => {
							rendererControllerRef.current = controller;
							controller?.setHighlight?.(currentHighlight);
						},
					})
				) : (
					<div className='canvas-fallback'>
						{t('Renderer not available for this output')}
					</div>
				)}
			</div>
		);
	}, [
		compiledOutput,
		provider.outputFormats,
		effectiveFormat,
		outputMimeType,
		sharedContent,
		handleLocationClick,
		currentHighlight,
	]);

	const hasOutput = !!compiledOutput;

	return (
		<div
			className={`ui-viewer ${className}`}
			data-role='typeset-output'
			style={{ position: 'relative' }}
		>
			<div className='ui-panel-header' data-role='output' data-shrink='true'>
				<div
					className='ui-tab-list scroll-x'
					data-role='output'
					data-variant='switcher'
					ref={outputTabsRef}
				>
					<button
						type='button'
						className={`ui-tab ${currentView === 'log' ? 'active' : ''}`}
						onClick={() => currentView !== 'log' && toggleOutputView()}
					>
						<div
							className='ui-status-dot'
							style={{
								backgroundColor: indicatorColor[logIndicator ?? 'idle'],
							}}
						/>
						{t('Log')}
						{logCounts.errors > 0 ? (
							<span
								className='ui-badge'
								data-variant='count'
								data-tone='danger'
								data-role='log-errors'
								title={t('Errors: {total}', { total: logCounts.errors })}
							>
								{logCounts.errors}
							</span>
						) : (
							logCounts.warnings > 0 && (
								<span
									className='ui-badge'
									data-variant='count'
									data-tone='warning'
									data-role='log-warnings'
									title={t('Warnings: {total}', {
										total: logCounts.warnings,
									})}
								>
									{logCounts.warnings}
								</span>
							)
						)}
					</button>

					{currentView === 'output' &&
						tabs.map((tab) => (
							<button
								type='button'
								key={tab.format}
								className={`ui-tab ${effectiveFormat === tab.format ? 'active' : ''}`}
								onClick={() => handleTabSwitch(tab.format)}
							>
								{tab.label}
							</button>
						))}

					{currentView === 'log' && (
						<button
							type='button'
							className='ui-tab'
							onClick={() => toggleOutputView()}
							disabled={!hasOutput}
						>
							{t('Output')}
						</button>
					)}
				</div>

				<ExternalCompileButton
					provider={provider}
					className='output-compile-button'
					onExpandExternalOutput={onExpandExternalOutput}
					linkedFileInfo={linkedFileInfo}
				/>
			</div>

			{compileError && (
				<div className='ui-message' data-tone='error'>
					{compileError}
				</div>
			)}

			{!compileLog && !hasOutput ? (
				<div className='empty-state ui-empty-state'>
					<p>
						{t(
							'No output available. Compile a {typesetter} document to see results.',
							{
								typesetter: provider.label,
							},
						)}
					</p>
				</div>
			) : (
				<>
					{currentView === 'log' && (
						<div className='log-view-container'>
							{loggerPlugin ? (
								<div className='split-log-view'>
									<ResizablePanel
										direction='vertical'
										alignment='end'
										height={visualizerHeight}
										minHeight={150}
										maxHeight={600}
										className='visualizer-panel-wrapper'
										onResize={handleVisualizerResize}
										collapsed={visualizerCollapsed}
										onCollapse={handleVisualizerCollapse}
									>
										<div className='visualizer-panel'>
											{createElement(loggerPlugin.renderVisualizer, {
												log: compileLog,
												onLineClick: handleLineClick,
											})}
										</div>
									</ResizablePanel>

									<div className='raw-log-panel'>
										<pre className='log-viewer ui-code-block' data-wrap='true'>
											{compileLog}
										</pre>
									</div>
								</div>
							) : (
								<div className='log-viewer ui-code-block' data-wrap='true'>
									<pre>{compileLog}</pre>
								</div>
							)}
						</div>
					)}

					<div
						style={{ display: currentView === 'output' ? 'contents' : 'none' }}
					>
						{outputViewerContent}
					</div>
				</>
			)}

			{sourceMapAvailable && (
				<SourceMapFloatingButton
					onForwardSync={() => {
						document.dispatchEvent(
							new CustomEvent('trigger-sourcemap-forward'),
						);
					}}
				/>
			)}
		</div>
	);
};

export default ExternalTypesetterOutput;
