// src/contexts/LaTeXContext.tsx
import type React from 'react';
import {
	type ReactNode,
	createContext,
	useEffect,
	useCallback,
	useRef,
	useState,
} from 'react';

import { t } from '@/i18n';
import { createNamedLogger } from '@/logging';
import { useFileTree } from '../hooks/useFileTree';
import { useSettings } from '../hooks/useSettings';
import { compileDiagnosticsService } from '../services/CompileDiagnosticsService';
import {
	compileOutputStore,
	projectKeyOf,
} from '../services/CompileOutputStore';
import { latexService } from '../services/LaTeXService';
import type {
	LaTeXContextType,
	LaTeXOutputFormat,
	LaTeXEngine,
} from '../types/latex';
import { LATEX_ENGINES } from '../types/latex';
import {
	parseUrlFragments,
	replaceHash,
	getProjectName,
} from '../utils/urlUtils';
import { popoutViewerService } from '../services/PopoutViewerService';

const moduleLog = createNamedLogger('LaTeXContext');

export const LaTeXContext = createContext<LaTeXContextType | null>(null);

interface LaTeXProviderProps {
	children: ReactNode;
	/** The open project, whose last PDF shows again when it opens. */
	docUrl?: string;
}

const BUILTIN_LATEX = 'internal:latex';

export const LaTeXProvider: React.FC<LaTeXProviderProps> = ({
	children,
	docUrl,
}) => {
	const projectKey = docUrl ? projectKeyOf(docUrl) : '';
	const { fileTree } = useFileTree();
	const { getSetting } = useSettings();
	const [isCompiling, setIsCompiling] = useState<boolean>(false);
	const [isInitializing, setIsInitializing] = useState(false);
	const [isExporting, setIsExporting] = useState(false);
	const [hasAutoCompiled, setHasAutoCompiled] = useState(false);
	const [compileError, setCompileError] = useState<string | null>(null);
	const [compiledPdf, setCompiledPdf] = useState<Uint8Array | null>(null);
	const [compileLog, setCompileLog] = useState<string>('');
	const [currentView, setCurrentView] = useState<'log' | 'output'>('log');
	const [logIndicator, setLogIndicator] = useState<
		'idle' | 'success' | 'error'
	>('idle');
	const [activeCompiler, setActiveCompiler] = useState<string | null>(null);
	const compileInProgressRef = useRef(false);
	const requestRef = useRef(0);

	const latexEngine =
		(getSetting('latex-engine')?.value as LaTeXEngine) ?? 'pdftex';
	// One PDF viewer, as on Overleaf: TeXlyre's Canvas view of the same PDF
	// is no longer offered.
	const currentFormat: LaTeXOutputFormat = 'pdf';
	const texliveEndpoint =
		(getSetting('latex-texlive-endpoint')?.value as string) ??
		'http://texlive.localhost:8082';
	const storeCache =
		(getSetting('latex-store-cache')?.value as boolean) ?? true;
	const storeWorkingDirectory =
		(getSetting('latex-store-working-directory')?.value as boolean) ?? false;
	const busyTeXEndpoint =
		(getSetting('latex-busytex-endpoint')?.value as string) ??
		'http://texlive2026.localhost:8082';
	const busyTeXBundles =
		(getSetting('latex-busytex-bundles')?.value as string) ?? 'recommended';

	useEffect(() => {
		const handleCompilerActive = (event: CustomEvent) => {
			setActiveCompiler(event.detail.type);
		};
		document.addEventListener(
			'compiler-active',
			handleCompilerActive as EventListener,
		);
		return () => {
			document.removeEventListener(
				'compiler-active',
				handleCompilerActive as EventListener,
			);
		};
	}, []);

	// The project's last PDF, kept in this browser, shows again when it
	// opens, as on Overleaf, unless a compile came first.
	useEffect(() => {
		setCompiledPdf(null);
		setCompileLog('');
		setCurrentView('log');
		setLogIndicator('idle');
		if (!projectKey) return;
		const request = requestRef.current;
		let current = true;
		void compileOutputStore.latest(projectKey, [BUILTIN_LATEX]).then((kept) => {
			if (!current || !kept || requestRef.current !== request) return;
			setCompileLog(kept.log);
			setCompiledPdf(kept.output);
			setCurrentView('output');
			setLogIndicator(kept.status === 0 ? 'success' : 'error');
			void compileDiagnosticsService.publish('latex', kept.log, kept.mainFile);
		});
		return () => {
			current = false;
		};
	}, [projectKey]);

	const keepPdf = (pdf: Uint8Array, log: string, mainFile: string) =>
		void compileOutputStore.save(projectKey, {
			providerId: BUILTIN_LATEX,
			// A copy of its own: it may be a view of a larger buffer.
			output: pdf.slice(),
			mimeType: 'application/pdf',
			format: 'pdf',
			log,
			status: 0,
			mainFile,
			compiledAt: Date.now(),
		});

	useEffect(() => {
		latexService.setTexliveEndpoint(texliveEndpoint);
		latexService.setStoreCache(storeCache);
		latexService.setStoreWorkingDirectory(storeWorkingDirectory);
		latexService.setBusyTeXEndpoint(busyTeXEndpoint);
		latexService.setBusyTeXBundles(busyTeXBundles.split(',').filter(Boolean));
	}, [
		texliveEndpoint,
		storeCache,
		storeWorkingDirectory,
		busyTeXEndpoint,
		busyTeXBundles,
	]);

	const compileDocument = async (
		mainFileName: string,
		format: LaTeXOutputFormat = currentFormat,
	): Promise<void> => {
		if (compileInProgressRef.current) return;

		const requestId = ++requestRef.current;
		compileInProgressRef.current = true;

		try {
			const engineToUse = latexService.getCurrentEngineType();
			if (!latexService.isReady()) {
				await latexService.initialize(engineToUse);
			}

			if (requestId !== requestRef.current) return;
		} catch (error) {
			if (requestId !== requestRef.current) return;
			compileInProgressRef.current = false;
			throw error;
		} finally {
			if (requestId === requestRef.current) {
				setIsInitializing(false);
			}
		}

		if (requestId !== requestRef.current) return;

		setIsCompiling(true);
		setCompileError(null);
		setActiveCompiler('latex');

		// setCompiledPdf(null);

		try {
			const result = await latexService.compileLaTeX(
				mainFileName,
				fileTree,
				format,
			);

			if (requestId !== requestRef.current) return;

			setCompileLog(result.log);
			void compileDiagnosticsService.publish('latex', result.log, mainFileName);
			if (result.status === 0 && result.pdf) {
				switch (format) {
					case 'pdf': {
						setCompiledPdf(result.pdf);
						setCurrentView('output');
						setLogIndicator('success');
						keepPdf(result.pdf, result.log, mainFileName);
						const fileName =
							mainFileName
								.split('/')
								.pop()
								?.replace(/\.(tex|ltx|latex)$/i, '.pdf') || 'output.pdf';
						popoutViewerService.sendContent({
							kind: 'pdf',
							content: result.pdf,
							mimeType: 'application/pdf',
							fileName,
							projectName: getProjectName(t('LaTeX Project')),
						});
						break;
					}
				}
			} else {
				setCompileError(
					t('Compilation failed. Check the log in the main window.'),
				);
				if (format === 'pdf') setCurrentView('log');
				setLogIndicator('error');
				popoutViewerService.sendCompileResult(result.status, result.log);
			}
		} catch (error) {
			if (requestId !== requestRef.current) return;

			setCompileError(
				error instanceof Error ? error.message : t('Unknown error'),
			);
			setCurrentView('log');
			setLogIndicator('error');

			popoutViewerService.sendCompileResult(
				-1,
				error instanceof Error ? error.message : t('Unknown error'),
			);
		} finally {
			if (requestId === requestRef.current) {
				setIsCompiling(false);
				compileInProgressRef.current = false;
			}
		}
	};

	const handleSetLatexEngine = useCallback(
		async (_engine: LaTeXEngine): Promise<void> => {
			// NOTE (fabawi): no-op since engine is now driven by project properties with global setting fallback.
		},
		[],
	);

	const triggerAutoCompile = useCallback(() => {
		const hashUrl = window.location.hash.substring(1);
		const fragments = parseUrlFragments(hashUrl);
		const engine = fragments.compile as LaTeXEngine;
		const isLatexEngine = LATEX_ENGINES.includes(engine);

		if (isLatexEngine) {
			const cleanUrl = hashUrl.replace(/&compile:[^&]*/, '');
			replaceHash(cleanUrl);
			document.dispatchEvent(
				new CustomEvent('trigger-compile-with-engine', { detail: { engine } }),
			);
			setHasAutoCompiled(true);
			return;
		}

		const autoCompileEnabled =
			(getSetting('latex-auto-compile-on-open')?.value as boolean) ?? false;
		if (autoCompileEnabled && !hasAutoCompiled) {
			document.dispatchEvent(new CustomEvent('trigger-compile'));
			setHasAutoCompiled(true);
		}
	}, [getSetting, hasAutoCompiled]);

	const stopCompilation = () => {
		if (!isCompiling && !compileInProgressRef.current) return;

		requestRef.current += 1;
		compileInProgressRef.current = false;

		latexService.stopCompilation();
		latexService.dismissCurrentNotification();

		setIsCompiling(false);
		setIsInitializing(false);
		setCompileError(t('Compilation stopped by user'));
	};

	const exportDocument = async (
		mainFileName: string,
		options: {
			engine?: LaTeXEngine;
			format?: 'pdf' | 'dvi';
			includeLog?: boolean;
			includeDvi?: boolean;
			includeBbl?: boolean;
			includeWorkDir?: boolean;
		} = {},
	): Promise<void> => {
		try {
			await latexService.exportDocument(mainFileName, fileTree, options);
		} finally {
			setIsExporting(false);
		}
	};

	const toggleOutputView = () => {
		setCurrentView(currentView === 'log' ? 'output' : 'log');
	};

	const clearCache = async (): Promise<void> => {
		try {
			await latexService.clearCacheDirectories();
		} catch (error) {
			moduleLog.error('Failed to clear cache:', error);
			setCompileError('Failed to clear cache');
		}
	};

	const compileWithClearCache = async (
		mainFileName: string,
		format: LaTeXOutputFormat = currentFormat,
	): Promise<void> => {
		if (compileInProgressRef.current) return;

		const requestId = ++requestRef.current;
		compileInProgressRef.current = true;

		try {
			const engineToUse = latexService.getCurrentEngineType();
			if (!latexService.isReady()) {
				await latexService.initialize(engineToUse);
			}

			if (requestId !== requestRef.current) return;
		} catch (error) {
			if (requestId !== requestRef.current) return;
			compileInProgressRef.current = false;
			throw error;
		} finally {
			if (requestId === requestRef.current) {
				setIsInitializing(false);
			}
		}

		if (requestId !== requestRef.current) return;

		setIsCompiling(true);
		setCompileError(null);
		setActiveCompiler('latex');

		setCompiledPdf(null);

		try {
			await latexService.clearCacheDirectories();
			if (requestId !== requestRef.current) return;

			const result = await latexService.compileLaTeX(
				mainFileName,
				fileTree,
				format,
			);

			if (requestId !== requestRef.current) return;

			setCompileLog(result.log);
			void compileDiagnosticsService.publish('latex', result.log, mainFileName);
			if (result.status === 0 && result.pdf) {
				switch (format) {
					case 'pdf': {
						setCompiledPdf(result.pdf);
						setCurrentView('output');
						setLogIndicator('success');
						keepPdf(result.pdf, result.log, mainFileName);
						const fileName =
							mainFileName
								.split('/')
								.pop()
								?.replace(/\.(tex|ltx|latex)$/i, '.pdf') || 'output.pdf';
						popoutViewerService.sendContent({
							kind: 'pdf',
							content: result.pdf,
							mimeType: 'application/pdf',
							fileName,
							projectName: getProjectName(t('LaTeX Project')),
						});
						break;
					}
				}
			} else {
				setCompileError(
					t('Compilation failed. Check the log in the main window.'),
				);
				if (format === 'pdf') setCurrentView('log');
				setLogIndicator('error');
				popoutViewerService.sendCompileResult(result.status, result.log);
			}
		} catch (error) {
			if (requestId !== requestRef.current) return;

			setCompileError(
				error instanceof Error ? error.message : t('Unknown error'),
			);
			setCurrentView('log');
			setLogIndicator('error');

			popoutViewerService.sendCompileResult(
				-1,
				error instanceof Error ? error.message : t('Unknown error'),
			);
		} finally {
			if (requestId === requestRef.current) {
				setIsCompiling(false);
				compileInProgressRef.current = false;
			}
		}
	};

	return (
		<LaTeXContext.Provider
			value={{
				isCompiling,
				isInitializing,
				setIsInitializing,
				isExporting,
				setIsExporting,
				compileError,
				compiledPdf,
				compileLog,
				currentFormat,
				compileDocument,
				stopCompilation,
				toggleOutputView,
				currentView,
				logIndicator,
				latexEngine,
				setLatexEngine: handleSetLatexEngine,
				clearCache,
				compileWithClearCache,
				triggerAutoCompile,
				activeCompiler,
				exportDocument,
			}}
		>
			{children}
		</LaTeXContext.Provider>
	);
};
