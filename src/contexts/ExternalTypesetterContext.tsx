// src/contexts/ExternalTypesetterContext.tsx
import type React from 'react';
import {
	type ReactNode,
	createContext,
	useCallback,
	useEffect,
	useRef,
	useState,
} from 'react';

import { typesetterRegistryService } from '../services/TypesetterRegistryService';
import { fileStoreService } from '../services/FileStoreService';
import { compileDiagnosticsService } from '../services/CompileDiagnosticsService';
import {
	compileOutputStore,
	projectKeyOf,
} from '../services/CompileOutputStore';
import { filePathCacheService } from '../services/FilePathCacheService';
import { latexSourceMapService } from '../services/LaTeXSourceMapService';
import {
	type PopoutContentKind,
	popoutViewerService,
} from '../services/PopoutViewerService';
import {
	genericTypesetterService,
	type TypesetterFile,
} from '../services/GenericTypesetterService';
import { type DownloadableFile, downloadFiles } from '../utils/archiveUtils';
import { findCompileArtifact, outputExtension } from '../utils/compilerUtils';
import { getProjectName } from '../utils/urlUtils';
import { toBytes } from '../utils/fileUtils';
import { cleanBytes } from '../utils/fileCommentUtils';

interface ExternalExportOptions {
	includeLog?: boolean;
	options?: Record<string, string | number | boolean>;
}

interface ExternalTypesetterContextType {
	isCompiling: boolean;
	isExporting: boolean;
	compileError: string | null;
	compileLog: string;
	compiledOutput: Uint8Array | null;
	outputMimeType: string | null;
	outputFormat: string | null;
	currentView: 'log' | 'output';
	logIndicator: 'idle' | 'success' | 'error';
	toggleOutputView: () => void;
	compileDocument: (
		providerId: string,
		mainFileName: string,
		format?: string,
		options?: Record<string, string | number | boolean>,
	) => Promise<void>;
	exportDocument: (
		providerId: string,
		mainFileName: string,
		format?: string,
		exportOptions?: ExternalExportOptions,
	) => Promise<void>;
	clearCache: (providerId: string) => Promise<void>;
	/** Stops the compile running, which then ends with its log. */
	stopCompilation: (providerId: string) => void;
}

export const ExternalTypesetterContext =
	createContext<ExternalTypesetterContextType | null>(null);

interface ExternalTypesetterProviderProps {
	children: ReactNode;
	/** The open project, whose last output shows again when it opens. */
	docUrl?: string;
}

const getBaseName = (filePath: string): string => {
	const name = filePath.split('/').pop() || filePath;
	return name.replace(/\.[^.]+$/, '');
};

export const ExternalTypesetterProvider: React.FC<
	ExternalTypesetterProviderProps
> = ({ children, docUrl }) => {
	const projectKey = docUrl ? projectKeyOf(docUrl) : '';
	const [isCompiling, setIsCompiling] = useState(false);
	const [isExporting, setIsExporting] = useState(false);
	const [compileError, setCompileError] = useState<string | null>(null);
	const [compileLog, setCompileLog] = useState('');
	const [compiledOutput, setCompiledOutput] = useState<Uint8Array | null>(null);
	const [outputMimeType, setOutputMimeType] = useState<string | null>(null);
	const [outputFormat, setOutputFormat] = useState<string | null>(null);
	const [currentView, setCurrentView] = useState<'log' | 'output'>('log');
	const [logIndicator, setLogIndicator] = useState<
		'idle' | 'success' | 'error'
	>('idle');

	const toggleOutputView = useCallback(() => {
		setCurrentView((view) => (view === 'log' ? 'output' : 'log'));
	}, []);

	// Compiles since the project opened, which a kept output must not cover.
	const compilesRef = useRef(0);

	// The project's last output, kept in this browser, shows again when it
	// opens, as on Overleaf, with its log, its errors in the editor and its
	// SyncTeX.
	useEffect(() => {
		setCompiledOutput(null);
		setOutputMimeType(null);
		setOutputFormat(null);
		setCompileLog('');
		setCurrentView('log');
		setLogIndicator('idle');
		if (!projectKey) return;
		const compiles = compilesRef.current;
		const external = typesetterRegistryService
			.list()
			.filter((provider) => provider.source !== 'builtin')
			.map((provider) => provider.id);
		let current = true;
		void compileOutputStore
			.latest(projectKey, external.length > 0 ? external : undefined)
			.then((kept) => {
				if (!current || !kept || compilesRef.current !== compiles) return;
				const provider = typesetterRegistryService.get(kept.providerId);
				if (provider?.source === 'builtin') return;
				setCompileLog(kept.log);
				setCompiledOutput(kept.output);
				setOutputMimeType(kept.mimeType);
				setOutputFormat(kept.format);
				setCurrentView('output');
				setLogIndicator(kept.status === 0 ? 'success' : 'error');
				void compileDiagnosticsService.publish(
					provider?.projectType ?? 'latex',
					kept.log,
					kept.mainFile,
				);
				if (kept.synctex) {
					document.dispatchEvent(
						new CustomEvent('compiler-active', { detail: { type: 'latex' } }),
					);
					filePathCacheService.setMainFilePath(kept.mainFile);
					latexSourceMapService.loadFromBytes(kept.synctex);
				}
			});
		return () => {
			current = false;
		};
	}, [projectKey]);

	const loadFiles = useCallback(async (): Promise<TypesetterFile[]> => {
		const nodes = await fileStoreService.getAllFiles(false, false, true);
		const files: TypesetterFile[] = [];

		for (const node of nodes) {
			if (node.type !== 'file' || node.content === undefined) continue;

			files.push({
				path: node.path,
				content: node.isBinary
					? toBytes(node.content)
					: cleanBytes(node.content),
				lastModified: node.lastModified,
			});
		}

		return files;
	}, []);

	const compileDocument = useCallback(
		async (
			providerId: string,
			mainFileName: string,
			format = 'pdf',
			options?: Record<string, string | number | boolean>,
		) => {
			const provider = typesetterRegistryService.get(providerId);
			if (!provider) {
				setCompileError(`Compiler not found: ${providerId}`);
				return;
			}

			setIsCompiling(true);
			setCompileError(null);
			compilesRef.current += 1;

			try {
				const files = await loadFiles();
				const result = await genericTypesetterService.compile(providerId, {
					mainFile: mainFileName,
					format,
					files,
					options,
				});

				setCompileLog(result.log);
				void compileDiagnosticsService.publish(
					provider.projectType,
					result.log,
					mainFileName,
				);

				// As on Overleaf, a PDF made despite errors is shown, and the
				// errors are counted on the log tab.
				if (result.output) {
					document.dispatchEvent(
						new CustomEvent('compiler-active', {
							detail: { type: 'latex' },
						}),
					);

					const synctex = findCompileArtifact(result.artifacts, 'synctex', [
						'.synctex',
						'.synctex.gz',
					]);

					if (synctex) {
						filePathCacheService.setMainFilePath(mainFileName);
						latexSourceMapService.loadFromBytes(synctex.data);
					} else {
						latexSourceMapService.clear();
					}

					const resolvedFormat = result.format || format;
					const outputFormat = provider.outputFormats.find(
						(f) => f.id === resolvedFormat,
					);
					const mimeType =
						result.mimeType ?? outputFormat?.mimeType ?? 'application/pdf';

					setCompiledOutput(result.output);
					setOutputMimeType(mimeType);
					setOutputFormat(resolvedFormat);
					setCurrentView('output');
					setLogIndicator(result.status === 0 ? 'success' : 'error');
					// Copies of their own: they may be views of a larger message.
					void compileOutputStore.save(projectKey, {
						providerId,
						output: result.output.slice(),
						mimeType,
						format: resolvedFormat,
						log: result.log,
						status: result.status,
						mainFile: mainFileName,
						...(synctex ? { synctex: synctex.data.slice() } : {}),
						compiledAt: Date.now(),
					});

					const kind: PopoutContentKind =
						outputFormat?.outputType === 'canvas'
							? mimeType === 'image/svg+xml'
								? 'canvas-svg'
								: 'canvas-pdf'
							: 'pdf';

					const extension = mimeType === 'image/svg+xml' ? 'svg' : 'pdf';

					popoutViewerService.sendContent({
						kind,
						content: result.output,
						mimeType,
						fileName: `${getBaseName(mainFileName)}.${extension}`,
						projectName: getProjectName(),
					});
				} else {
					latexSourceMapService.clear();
					setLogIndicator('error');
					setCurrentView('log');
					popoutViewerService.sendCompileResult(result.status, result.log);
				}
			} catch (error) {
				latexSourceMapService.clear();
				const message = error instanceof Error ? error.message : String(error);
				setCompileError(message);
				setLogIndicator('error');
				setCurrentView('log');
				popoutViewerService.sendCompileResult(-1, message);
			} finally {
				setIsCompiling(false);
			}
		},
		[loadFiles, projectKey],
	);

	const exportDocument = useCallback(
		async (
			providerId: string,
			mainFileName: string,
			format = 'pdf',
			exportOptions: ExternalExportOptions = {},
		) => {
			const provider = typesetterRegistryService.get(providerId);
			if (!provider) {
				setCompileError(`Compiler not found: ${providerId}`);
				return;
			}

			setIsExporting(true);
			setCompileError(null);

			try {
				const files = await loadFiles();
				const result = await genericTypesetterService.compile(providerId, {
					mainFile: mainFileName,
					format,
					files,
					options: { ...(exportOptions.options ?? {}), export: true },
				});

				setCompileLog(result.log);

				// The PDF shown despite errors may be downloaded too.
				if (!result.output) {
					setLogIndicator('error');
					setCurrentView('log');
					return;
				}

				const baseName = getBaseName(mainFileName);
				const mimeType =
					result.mimeType ??
					provider.outputFormats.find((f) => f.id === result.format)
						?.mimeType ??
					'application/octet-stream';

				const downloads: DownloadableFile[] = [
					{
						content: result.output,
						name: `${baseName}.${outputExtension(result.mimeType, result.format || format)}`,
						mimeType,
					},
				];

				if (exportOptions.includeLog) {
					downloads.push({
						content: new TextEncoder().encode(result.log),
						name: `${baseName}.log`,
						mimeType: 'text/plain',
					});
				}

				await downloadFiles(downloads, baseName);
				setLogIndicator(result.status === 0 ? 'success' : 'error');
			} catch (error) {
				setCompileError(error instanceof Error ? error.message : String(error));
				setLogIndicator('error');
				setCurrentView('log');
			} finally {
				setIsExporting(false);
			}
		},
		[loadFiles],
	);

	const clearCache = useCallback(async (providerId: string) => {
		try {
			genericTypesetterService.resetSyncState(providerId);
			await genericTypesetterService.compile(providerId, {
				mainFile: '',
				format: '',
				files: [],
				options: { action: 'clear-cache' },
			});
		} catch (error) {
			setCompileError(error instanceof Error ? error.message : String(error));
		}
	}, []);

	const stopCompilation = useCallback((providerId: string) => {
		genericTypesetterService.stop(providerId);
	}, []);

	return (
		<ExternalTypesetterContext.Provider
			value={{
				isCompiling,
				isExporting,
				compileError,
				compileLog,
				compiledOutput,
				outputMimeType,
				outputFormat,
				currentView,
				logIndicator,
				toggleOutputView,
				compileDocument,
				exportDocument,
				clearCache,
				stopCompilation,
			}}
		>
			{children}
		</ExternalTypesetterContext.Provider>
	);
};
