// extras/renderers/pdf/PdfRenderer.tsx
import type React from 'react';
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useImperativeHandle,
} from 'react';
import { flushSync } from 'react-dom';
import * as pdfjs from 'pdfjs-dist';
import 'pdfjs-dist/web/pdf_viewer.css';

import { t } from '@/i18n';
import { PluginHeader } from '@/components/common/PluginHeader';
import { formatFileSize } from '@/utils/fileUtils';
import {
	ChevronLeftIcon,
	ChevronRightIcon,
	DownloadIcon,
	PageIcon,
	ScrollIcon,
	FitToWidthIcon,
	FitToHeightIcon,
	ZoomInIcon,
	ZoomOutIcon,
	ExpandIcon,
	MinimizeIcon,
} from '@/components/common/Icons';
import { getPdfRendererSettings } from './settings';
import { useSettings } from '@/hooks/useSettings';
import { useProperties } from '@/hooks/useProperties';
import type { RendererProps } from '@/plugins/PluginInterface';
import { PdfJsFullViewer, type PdfJsFullViewerHandle } from './PdfJsFullViewer';
import './styles.css';
import { createNamedLogger } from '@/logging';
const moduleLog = createNamedLogger('PdfRenderer');

const BASE_PATH = __BASE_PATH__;

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
	'pdfjs-dist/build/pdf.worker.min.mjs',
	import.meta.url,
).toString();

type PageSize = { width: number; height: number };
// As on Overleaf, the zoom may follow the panel: the page as wide, or as
// high, as the panel, whatever its size.
type ZoomMode = 'page-width' | 'page-height';
type Highlight = {
	page: number;
	rects: Array<{ x: number; y: number; width: number; height: number }>;
} | null;

const DEFAULT_WIDTH = 595;
const DEFAULT_HEIGHT = 842;
const MIN_SCALE = 0.25;
const MAX_SCALE = 5;
const ZOOM_STEP = 0.25;

const clamp = (value: number, min: number, max: number) =>
	Math.max(min, Math.min(max, value));

const isZoomMode = (value: unknown): value is ZoomMode =>
	value === 'page-width' || value === 'page-height';

// Ctrl+wheel and pinching: about 16% a notch of the wheel.
const WHEEL_ZOOM_BASE = 1.0015;

// Every byte counts: two compiles often give PDFs of the same length that
// differ only inside, and the new one must replace the old.
const getContentHash = (buffer: ArrayBuffer): string => {
	const view = new Uint8Array(buffer);
	// FNV-1a, 32 bits.
	let hash = 0x811c9dc5;
	for (let index = 0; index < view.length; index++) {
		hash = Math.imul(hash ^ view[index], 0x01000193);
	}
	return `${buffer.byteLength}-${(hash >>> 0).toString(16)}`;
};

const toArrayBuffer = (
	content: ArrayBuffer | Uint8Array | string,
): ArrayBuffer => {
	if (content instanceof ArrayBuffer) return content;
	if (typeof content === 'string')
		return new TextEncoder().encode(content).buffer;
	const copy = new Uint8Array(content.byteLength);
	copy.set(content);
	return copy.buffer;
};

const loadPdfDocument = async (pdfData: Uint8Array) => {
	const loadingTask = pdfjs.getDocument({
		data: new Uint8Array(pdfData).slice(),
		cMapUrl: `${BASE_PATH}/assets/cmaps/`,
		cMapPacked: true,
		enableXfa: true,
		disableFontFace: false,
		useSystemFonts: true,
		fontExtraProperties: true,
	});

	return loadingTask.promise;
};

const PdfRenderer: React.FC<RendererProps> = ({
	content,
	fileName,
	onDownload,
	controllerRef,
	onLocationClick,
	headerLabel,
	headerTitle,
	memoryOptimized = false,
}) => {
	const { getSetting } = useSettings();
	const { getProperty, setProperty, registerProperty } = useProperties();

	const pdfRendererEnable =
		(getSetting('pdf-renderer-enable')?.value as boolean) ?? true;
	const pdfRendererTextSelection =
		(getSetting('pdf-renderer-text-selection')?.value as boolean) ?? true;
	const pdfRendererAnnotations =
		(getSetting('pdf-renderer-annotations')?.value as boolean) ?? true;

	const [numPages, setNumPages] = useState(0);
	const [currentPage, setCurrentPage] = useState(1);
	const [pageInput, setPageInput] = useState('1');
	const [isEditingPageInput, setIsEditingPageInput] = useState(false);
	const [scale, setScale] = useState(1);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [pdfDocument, setPdfDocument] = useState<any>(null);
	const [scrollView, setScrollView] = useState(true);
	const [isFullscreen, setIsFullscreen] = useState(false);
	const [zoomMode, setZoomMode] = useState<ZoomMode | null>('page-width');
	const [highlight, setHighlight] = useState<Highlight>(null);

	const propertiesRegistered = useRef(false);
	const pageSizes = useRef<Map<number, PageSize>>(new Map());
	const lastStablePageRef = useRef(1);
	const contentHashRef = useRef('');
	const originalContentRef = useRef<ArrayBuffer | null>(null);
	const pendingRestorePageRef = useRef<number | null>(null);
	// Whether the viewer keeps its place for the PDF being loaded.
	const keepingPlaceRef = useRef(false);
	const numPagesRef = useRef(0);
	const scaleRef = useRef(1);
	const zoomModeRef = useRef<ZoomMode | null>('page-width');
	const applyZoomModeRef = useRef<(mode: ZoomMode) => void>(() => {});
	const pointerInsideRef = useRef(false);
	const containerRef = useRef<HTMLDivElement>(null);
	const contentElRef = useRef<HTMLDivElement>(null);
	const fullViewerRef = useRef<PdfJsFullViewerHandle | null>(null);

	useEffect(() => {
		numPagesRef.current = numPages;
	}, [numPages]);

	useEffect(() => {
		scaleRef.current = scale;
	}, [scale]);

	useEffect(() => {
		zoomModeRef.current = zoomMode;
	}, [zoomMode]);

	useEffect(() => {
		return () => {
			pdfDocument?.loadingTask?.destroy?.();
		};
	}, [pdfDocument]);

	const tooltipInfo = useMemo(() => {
		if (numPages <= 0) return undefined;

		const firstSize = pageSizes.current.get(1);
		const fileSize = originalContentRef.current?.byteLength ?? 0;

		return [
			t('Type: PDF'),
			t('MIME Type: {mimeType}', { mimeType: 'application/pdf' }),
			t('Pages: {count}', { count: numPages }),
			t('Dimensions: {width} × {height}', {
				width: firstSize?.width ?? '—',
				height: firstSize?.height ?? '—',
			}),
			t('Size: {size}', { size: formatFileSize(fileSize) }),
		];
	}, [numPages]);

	const setPage = useCallback(
		(page: number) => {
			const target = clamp(page, 1, numPagesRef.current || 1);
			lastStablePageRef.current = target;
			setCurrentPage(target);
			if (!isEditingPageInput) setPageInput(String(target));
			setProperty('pdf-renderer-current-page', target);
		},
		[isEditingPageInput, setProperty],
	);

	const goToPage = useCallback(
		(page: number) => {
			const target = clamp(page, 1, numPagesRef.current || 1);
			setPage(target);
			fullViewerRef.current?.goToPage(target);
		},
		[setPage],
	);

	const setPdfContent = useCallback(
		(buffer: ArrayBuffer) => {
			if (!buffer || buffer.byteLength === 0) {
				setPdfDocument((previous: any) => {
					previous?.loadingTask?.destroy?.();
					return null;
				});
				originalContentRef.current = null;
				contentHashRef.current = '';
				pageSizes.current.clear();
				setNumPages(0);
				setError(t('No PDF content available'));
				setIsLoading(false);
				return;
			}

			try {
				const nextHash = getContentHash(buffer);
				if (contentHashRef.current === nextHash) return;

				const dataCopy = memoryOptimized
					? new Uint8Array(buffer)
					: new Uint8Array(new Uint8Array(buffer));
				pendingRestorePageRef.current = lastStablePageRef.current;
				keepingPlaceRef.current =
					fullViewerRef.current?.keepPlaceForNextDocument() ?? false;
				originalContentRef.current = memoryOptimized
					? buffer
					: dataCopy.buffer.slice(0);
				contentHashRef.current = nextHash;
				pageSizes.current.clear();
				setError(null);
				setIsLoading(true);

				loadPdfDocument(dataCopy)
					.then((nextDocument) => {
						setPdfDocument((previous: any) => {
							previous?.loadingTask?.destroy?.();
							return nextDocument;
						});
					})
					.catch((error) => {
						setError(
							t('Failed to load PDF: {error}', {
								error: error instanceof Error ? error.message : String(error),
							}),
						);
						setIsLoading(false);
					});
			} catch (error) {
				moduleLog.error('Error creating PDF data:', error);
				setError(
					t('Failed to process PDF content: {error}', {
						error: error instanceof Error ? error.message : t('Unknown error'),
					}),
				);
				setIsLoading(false);
			}
		},
		[memoryOptimized],
	);

	useImperativeHandle(
		controllerRef,
		() => ({
			updateContent: (nextContent: ArrayBuffer | Uint8Array | string) => {
				setPdfContent(toArrayBuffer(nextContent));
			},
			updatePdfContent: (nextContent: ArrayBuffer | string) => {
				setPdfContent(toArrayBuffer(nextContent));
			},
			setHighlight: (nextHighlight: Highlight) => {
				setHighlight(nextHighlight);
				if (nextHighlight) {
					const { page, rects } = nextHighlight;
					const top = Math.min(...rects.map((rect) => rect.y));
					requestAnimationFrame(() => {
						setPage(page);
						// The marked line, not only its page.
						fullViewerRef.current?.goToLocation(
							page,
							Number.isFinite(top) ? top : 0,
						);
					});
				}
			},
		}),
		[setPage, setPdfContent],
	);

	useEffect(() => {
		if (propertiesRegistered.current) return;
		propertiesRegistered.current = true;

		// pdf-renderer-zoom and pdf-renderer-scroll-view, before these, kept
		// one page at 100% for everyone: these start as on Overleaf, with all
		// the pages, as wide as the panel.
		registerProperty({
			id: 'pdf-renderer-scale',
			category: 'UI',
			subcategory: 'PDF Viewer',
			defaultValue: 'page-width',
		});

		registerProperty({
			id: 'pdf-renderer-continuous',
			category: 'UI',
			subcategory: 'PDF Viewer',
			defaultValue: true,
		});

		registerProperty({
			id: 'pdf-renderer-current-page',
			category: 'UI',
			subcategory: 'PDF Viewer',
			defaultValue: 1,
		});

		const storedScale = getProperty('pdf-renderer-scale');
		const storedScrollView = getProperty('pdf-renderer-continuous');
		const storedPage = Number(getProperty('pdf-renderer-current-page'));

		if (isZoomMode(storedScale)) {
			setZoomMode(storedScale);
		} else if (Number.isFinite(Number(storedScale))) {
			setZoomMode(null);
			setScale(clamp(Number(storedScale), MIN_SCALE, MAX_SCALE));
		}

		if (storedScrollView !== undefined) {
			setScrollView(Boolean(storedScrollView));
		}

		if (Number.isFinite(storedPage) && storedPage >= 1) {
			pendingRestorePageRef.current = storedPage;
		}
	}, [registerProperty, getProperty]);

	useEffect(() => {
		if (content instanceof ArrayBuffer && content.byteLength > 0) {
			setPdfContent(content);
		}
	}, [content, setPdfContent]);

	const handleDocumentReady = useCallback(
		(loadedNumPages: number) => {
			const restorePage = clamp(
				pendingRestorePageRef.current || lastStablePageRef.current || 1,
				1,
				loadedNumPages || 1,
			);

			pendingRestorePageRef.current = null;
			numPagesRef.current = loadedNumPages;
			lastStablePageRef.current = restorePage;
			setNumPages(loadedNumPages);
			setCurrentPage(restorePage);
			if (!isEditingPageInput) setPageInput(String(restorePage));
			setIsLoading(false);
			setError(null);

			requestAnimationFrame(() => {
				// The pages of a new compile may have another size.
				if (zoomModeRef.current) {
					applyZoomModeRef.current(zoomModeRef.current);
				}
				if (!keepingPlaceRef.current) {
					fullViewerRef.current?.goToPage(restorePage);
				}
				keepingPlaceRef.current = false;
			});
		},
		[isEditingPageInput],
	);

	const handlePageSize = useCallback((page: number, size: PageSize) => {
		pageSizes.current.set(page, size);
	}, []);

	const computeFitScale = useCallback((mode: 'fit-width' | 'fit-height') => {
		const resolved = fullViewerRef.current?.applyFitScale(mode);
		if (resolved !== null && resolved !== undefined) {
			return clamp(resolved, MIN_SCALE, MAX_SCALE);
		}

		const container = contentElRef.current;
		const size = fullViewerRef.current?.getPageSize(
			lastStablePageRef.current,
		) ||
			pageSizes.current.get(lastStablePageRef.current) || {
				width: DEFAULT_WIDTH,
				height: DEFAULT_HEIGHT,
			};

		return mode === 'fit-width'
			? clamp(
					((container?.clientWidth || 800) - 40) / size.width,
					MIN_SCALE,
					MAX_SCALE,
				)
			: clamp(
					((container?.clientHeight || 600) - 40) / size.height,
					MIN_SCALE,
					MAX_SCALE,
				);
	}, []);

	// A zoom of its own, in percent.
	const commitZoom = useCallback(
		(nextScale: number) => {
			nextScale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
			if (nextScale === scaleRef.current && zoomModeRef.current === null) {
				return;
			}

			zoomModeRef.current = null;
			scaleRef.current = nextScale;
			flushSync(() => {
				setZoomMode(null);
				setScale(nextScale);
			});

			fullViewerRef.current?.setScale(nextScale);
			setProperty('pdf-renderer-scale', nextScale);
		},
		[setProperty],
	);

	// The scale that makes the page as wide, or as high, as the panel now.
	const applyZoomMode = useCallback(
		(mode: ZoomMode) => {
			const nextScale = computeFitScale(
				mode === 'page-width' ? 'fit-width' : 'fit-height',
			);
			scaleRef.current = nextScale;
			setScale(nextScale);
		},
		[computeFitScale],
	);

	applyZoomModeRef.current = applyZoomMode;

	const chooseZoomMode = useCallback(
		(mode: ZoomMode) => {
			zoomModeRef.current = mode;
			setZoomMode(mode);
			applyZoomMode(mode);
			setProperty('pdf-renderer-scale', mode);
		},
		[applyZoomMode, setProperty],
	);

	const commitZoomRef = useRef(commitZoom);
	commitZoomRef.current = commitZoom;

	const handlePreviousPage = useCallback(() => {
		goToPage(lastStablePageRef.current - 1);
	}, [goToPage]);

	const handleNextPage = useCallback(() => {
		goToPage(lastStablePageRef.current + 1);
	}, [goToPage]);

	const handlePageInputKeyDown = useCallback(
		(event: React.KeyboardEvent<HTMLInputElement>) => {
			if (event.key !== 'Enter') return;
			const page = Number.parseInt(pageInput, 10);

			if (Number.isFinite(page)) goToPage(page);
			else setPageInput(String(currentPage));

			setIsEditingPageInput(false);
			event.currentTarget.blur();
		},
		[pageInput, currentPage, goToPage],
	);

	const handleFitToggle = useCallback(() => {
		chooseZoomMode(zoomMode === 'page-width' ? 'page-height' : 'page-width');
	}, [zoomMode, chooseZoomMode]);

	const handleZoomChange = useCallback(
		(event: React.ChangeEvent<HTMLSelectElement>) => {
			const { value } = event.target;
			if (value === 'custom') return;
			if (isZoomMode(value)) chooseZoomMode(value);
			else commitZoom(Number.parseFloat(value) / 100);
		},
		[chooseZoomMode, commitZoom],
	);

	// A zoom that follows the panel follows it as it is resized.
	/* biome-ignore lint/correctness/useExhaustiveDependencies: pdfRendererEnable decides whether the content element exists. */
	useEffect(() => {
		const element = contentElRef.current;
		if (!element) return;
		let width = element.clientWidth;
		let height = element.clientHeight;
		let frame = 0;
		const observer = new ResizeObserver(() => {
			if (element.clientWidth === width && element.clientHeight === height) {
				return;
			}
			width = element.clientWidth;
			height = element.clientHeight;
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => {
				const mode = zoomModeRef.current;
				if (mode && width > 0 && height > 0) applyZoomMode(mode);
			});
		});
		observer.observe(element);
		return () => {
			observer.disconnect();
			cancelAnimationFrame(frame);
		};
	}, [applyZoomMode, pdfRendererEnable]);

	// Ctrl+wheel, and pinching on a touchpad, zoom the PDF, not the page.
	/* biome-ignore lint/correctness/useExhaustiveDependencies: pdfRendererEnable decides whether the content element exists. */
	useEffect(() => {
		const element = contentElRef.current;
		if (!element) return;
		const handleWheel = (event: WheelEvent) => {
			if (!event.ctrlKey && !event.metaKey) return;
			event.preventDefault();
			const delta = clamp(
				event.deltaMode === WheelEvent.DOM_DELTA_LINE
					? event.deltaY * 33
					: event.deltaY,
				-100,
				100,
			);
			commitZoomRef.current(scaleRef.current * WHEEL_ZOOM_BASE ** -delta);
		};
		element.addEventListener('wheel', handleWheel, { passive: false });
		return () => element.removeEventListener('wheel', handleWheel);
	}, [pdfRendererEnable]);

	const handleToggleView = useCallback(() => {
		const nextScrollView = !scrollView;
		pendingRestorePageRef.current = lastStablePageRef.current;
		setScrollView(nextScrollView);
		setProperty('pdf-renderer-continuous', nextScrollView);
	}, [scrollView, setProperty]);

	const handleToggleFullscreen = useCallback(() => {
		if (document.fullscreenElement === containerRef.current) {
			document.exitFullscreen().then(() => setIsFullscreen(false));
			return;
		}

		if (!document.fullscreenElement) {
			containerRef.current
				?.requestFullscreen()
				.then(() => setIsFullscreen(true));
		}
	}, []);

	useEffect(() => {
		// A zoom following the panel follows it to full screen and back.
		const handleFullscreenChange = () => {
			setIsFullscreen(document.fullscreenElement === containerRef.current);
		};

		document.addEventListener('fullscreenchange', handleFullscreenChange);
		return () =>
			document.removeEventListener('fullscreenchange', handleFullscreenChange);
	}, []);

	const handleExport = useCallback(() => {
		if (onDownload && fileName) {
			onDownload(fileName);
			return;
		}

		if (!originalContentRef.current?.byteLength) {
			setError(t('Cannot export: PDF content is not available'));
			return;
		}

		try {
			const blob = new Blob([originalContentRef.current], {
				type: 'application/pdf',
			});
			const url = URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = url;
			link.download = fileName || 'document.pdf';
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			URL.revokeObjectURL(url);
		} catch (error) {
			moduleLog.error('Export error:', error);
			setError(t('Failed to export PDF'));
		}
	}, [fileName, onDownload]);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			const active = document.activeElement;
			const isTyping =
				active instanceof HTMLInputElement ||
				active instanceof HTMLTextAreaElement ||
				active instanceof HTMLSelectElement ||
				active?.getAttribute('contenteditable') === 'true';

			if (isTyping) return;
			if (!document.fullscreenElement && !pointerInsideRef.current) return;

			if (
				event.key === 'ArrowLeft' ||
				event.key === 'ArrowUp' ||
				event.key === 'PageUp'
			) {
				event.preventDefault();
				handlePreviousPage();
			}

			if (
				event.key === 'ArrowRight' ||
				event.key === 'ArrowDown' ||
				event.key === ' ' ||
				event.key === 'PageDown'
			) {
				event.preventDefault();
				handleNextPage();
			}
		};

		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [handlePreviousPage, handleNextPage]);

	if (!pdfRendererEnable) {
		return (
			<div className='pdf-renderer-container ui-viewer' data-surface='base'>
				<div
					className='ui-message'
					data-placement='overlay-center'
					data-variant='error'
				>
					{t(
						'Enhanced PDF renderer is disabled. Please enable it in settings to use this renderer.',
					)}
				</div>
			</div>
		);
	}

	const zoomOptions =
		getPdfRendererSettings().find(
			(setting) => setting.id === 'pdf-renderer-initial-zoom',
		)?.options || [];

	const currentZoom = Math.round(scale * 100).toString();
	const hasCustomZoom = !zoomOptions.some(
		(option) => String(option.value) === currentZoom,
	);

	return (
		<div
			className='pdf-renderer-container ui-viewer'
			data-surface='base'
			ref={containerRef}
			onMouseEnter={() => {
				pointerInsideRef.current = true;
			}}
			onMouseLeave={() => {
				pointerInsideRef.current = false;
			}}
		>
			<div className='renderer-toolbar'>
				<div
					className='renderer-toolbar-content ui-toolbar'
					data-no-left={!headerLabel ? 'true' : undefined}
				>
					{headerLabel && (
						<div className='renderer-toolbar-left'>
							<PluginHeader
								fileName={headerLabel}
								filePath={headerTitle}
								tooltipInfo={tooltipInfo}
							/>
						</div>
					)}
					<div className='renderer-toolbar-right'>
						<div className='ui-toolbar-section' data-gap='control'>
							<button
								type='button'
								onClick={handlePreviousPage}
								className='ui-icon-button'
								data-variant='control'
								title={t('Previous Page')}
								disabled={currentPage <= 1 || isLoading}
							>
								<ChevronLeftIcon />
							</button>
							<button
								type='button'
								onClick={handleNextPage}
								className='ui-icon-button'
								data-variant='control'
								title={t('Next Page')}
								disabled={currentPage >= numPages || isLoading}
							>
								<ChevronRightIcon />
							</button>
						</div>

						<div className='ui-toolbar-section' data-gap='control'>
							<div className='ui-control-cluster'>
								<input
									type='number'
									value={pageInput}
									onChange={(event) => setPageInput(event.target.value)}
									onKeyDown={handlePageInputKeyDown}
									onFocus={() => setIsEditingPageInput(true)}
									onBlur={() => {
										setIsEditingPageInput(false);
										setPageInput(String(currentPage));
									}}
									className='ui-field-control'
									data-width='numeric'
									min={1}
									max={numPages}
									disabled={isLoading}
								/>
								<span>/</span>
								<span>{numPages}</span>
							</div>
						</div>

						<div className='ui-toolbar-section' data-gap='control'>
							<button
								type='button'
								onClick={() => commitZoom(scale - ZOOM_STEP)}
								className='ui-icon-button'
								data-variant='control'
								title={t('Zoom Out')}
								disabled={isLoading}
							>
								<ZoomOutIcon />
							</button>

							<select
								value={zoomMode ?? (hasCustomZoom ? 'custom' : currentZoom)}
								onChange={handleZoomChange}
								disabled={isLoading}
								className='renderer-toolbar-select ui-field-control'
								title={t('Zoom Level')}
							>
								<option value='page-width'>{t('Page width')}</option>
								<option value='page-height'>{t('Page height')}</option>
								{zoomOptions.map((option) => (
									<option
										key={String(option.value)}
										value={String(option.value)}
									>
										{option.label}
									</option>
								))}
								{hasCustomZoom && !zoomMode && (
									<option value='custom'>{Math.round(scale * 100)}%</option>
								)}
							</select>

							<button
								type='button'
								onClick={() => commitZoom(scale + ZOOM_STEP)}
								className='ui-icon-button'
								data-variant='control'
								title={t('Zoom In')}
								disabled={isLoading}
							>
								<ZoomInIcon />
							</button>
						</div>

						<div className='ui-toolbar-section' data-gap='control'>
							<button
								type='button'
								onClick={handleFitToggle}
								className='ui-icon-button'
								data-variant='control'
								title={
									zoomMode === 'page-width'
										? t('Fit to Height')
										: t('Fit to Width')
								}
								disabled={isLoading}
							>
								{zoomMode === 'page-width' ? (
									<FitToHeightIcon />
								) : (
									<FitToWidthIcon />
								)}
							</button>

							<button
								type='button'
								onClick={handleToggleView}
								className='ui-icon-button'
								data-variant='control'
								title={scrollView ? t('Single Page View') : t('Scroll View')}
								disabled={isLoading}
							>
								{scrollView ? <PageIcon /> : <ScrollIcon />}
							</button>

							<button
								type='button'
								onClick={handleToggleFullscreen}
								className='ui-icon-button'
								data-variant='control'
								title={isFullscreen ? t('Exit Fullscreen') : t('Fullscreen')}
								disabled={isLoading}
							>
								{isFullscreen ? <MinimizeIcon /> : <ExpandIcon />}
							</button>
						</div>

						<div className='ui-toolbar-section' data-gap='control'>
							<button
								type='button'
								onClick={handleExport}
								className='ui-icon-button'
								data-variant='control'
								title={t('Download')}
								disabled={isLoading}
							>
								<DownloadIcon />
							</button>
						</div>
					</div>
				</div>
			</div>

			<div
				className={`ui-viewer-content renderer-content ${isFullscreen ? 'fullscreen' : ''}`}
				data-layout='fill'
				ref={contentElRef}
			>
				{pdfDocument && (
					<PdfJsFullViewer
						ref={fullViewerRef}
						pdfDocument={pdfDocument}
						scale={scale}
						currentPage={currentPage}
						scrollView={scrollView}
						textSelection={pdfRendererTextSelection}
						annotations={pdfRendererAnnotations}
						highlight={highlight}
						onDocumentReady={handleDocumentReady}
						onPageChange={setPage}
						onPageSize={handlePageSize}
						onLocationClick={onLocationClick}
						onError={(error) => {
							setError(
								t('Failed to load PDF: {error}', { error: error.message }),
							);
							setIsLoading(false);
						}}
						memoryOptimized={memoryOptimized}
					/>
				)}

				{isLoading && !pdfDocument && (
					<div
						className='ui-message'
						data-placement='overlay-center'
						data-variant='loading'
					>
						{t('Loading PDF document...')}
					</div>
				)}
			</div>

			{error && (
				<div
					className='ui-message'
					data-placement='overlay-center'
					data-variant='error'
				>
					{error}
				</div>
			)}
		</div>
	);
};

export default PdfRenderer;
