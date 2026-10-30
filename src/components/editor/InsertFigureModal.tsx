// src/components/editor/InsertFigureModal.tsx
import type { EditorView } from '@codemirror/view';
import type React from 'react';
import { type RefObject, useEffect, useState } from 'react';

import { t } from '@/i18n';
import {
	applyFigureChanges,
	figureSelectionField,
} from '../../extensions/codemirror/visual/figureWidget';
import {
	type LatexFigure,
	parseLatexFigure,
	setFigureImage,
	setFigureParts,
	setFigureWidth,
} from '../../extensions/codemirror/visual/latexFigure';
import { filePathCacheService } from '../../services/FilePathCacheService';
import { fileStoreService } from '../../services/FileStoreService';
import {
	type FigureDialogMode,
	INSERT_FIGURE_EVENT,
	addFigureImage,
	canPreviewImage,
	figureLabel,
	figureLatex,
	insertFigure,
	isFigureImage,
} from '../../utils/latexFigureUtils';
import Modal from '../common/Modal';

interface InsertFigureModalProps {
	/** The editor this dialog inserts into. */
	editorRef: RefObject<HTMLDivElement | null>;
	/** Whether images may be added to the project (not for reviewers). */
	canUpload: boolean;
}

const WIDTHS = ['0.25', '0.5', '0.75', '1'];
// The width of an image whose size is not a part of the line.
const KEEP = 'keep';

// The project image a figure shows, its extension written or not.
const imageOf = (images: string[], path: string) => {
	const wanted = path.replace(/^\.\//, '');
	return images.find((image) => {
		const relative = filePathCacheService.toCompileRelativePath(image);
		return relative === wanted || relative.replace(/\.[^./]+$/, '') === wanted;
	});
};

// The selected figure, as the document has it now.
const selectedFigure = (view: EditorView): LatexFigure | null => {
	const at = view.state.field(figureSelectionField, false) ?? null;
	return at === null ? null : parseLatexFigure(view.state.doc.toString(), at);
};

/**
 * Overleaf's "Insert figure": an image of the project, or one added from
 * the computer, as a centred figure with a caption and a label. The same
 * dialog edits the selected figure, or replaces its image.
 */
const InsertFigureModal: React.FC<InsertFigureModalProps> = ({
	editorRef,
	canUpload,
}) => {
	const [view, setView] = useState<EditorView | null>(null);
	const [mode, setMode] = useState<FigureDialogMode>('insert');
	const [images, setImages] = useState<string[]>([]);
	const [source, setSource] = useState<'project' | 'upload'>('project');
	const [selected, setSelected] = useState('');
	const [upload, setUpload] = useState<File | null>(null);
	const [width, setWidth] = useState('0.5');
	const [widths, setWidths] = useState<string[]>(WIDTHS);
	const [withCaption, setWithCaption] = useState(true);
	const [withLabel, setWithLabel] = useState(true);
	const [preview, setPreview] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const open = async (event: Event) => {
			const detail = (
				event as CustomEvent<{ view: EditorView; mode?: FigureDialogMode }>
			).detail;
			const target = detail?.view;
			if (!target || !editorRef.current?.contains(target.dom)) return;
			const nextMode = detail.mode ?? 'insert';
			const figure = nextMode === 'insert' ? null : selectedFigure(target);
			if (nextMode !== 'insert' && !figure) return;
			const files = await fileStoreService.getAllFiles(false, false, false);
			const found = files
				.filter(
					(file) =>
						file.type === 'file' && !file.isDeleted && isFigureImage(file.path),
				)
				.map((file) => file.path)
				.sort((a, b) => a.localeCompare(b));
			const shown = figure ? imageOf(found, figure.graphics.path) : undefined;
			setImages(found);
			setSelected(
				nextMode === 'edit'
					? (shown ?? '')
					: (found.find((path) => path !== shown) ?? found[0] ?? ''),
			);
			setSource(found.length > 0 || !canUpload ? 'project' : 'upload');
			setUpload(null);
			const current = figure
				? figure.graphics.width === null
					? KEEP
					: String(figure.graphics.width)
				: '0.5';
			setWidth(current);
			setWidths(
				WIDTHS.includes(current)
					? WIDTHS
					: [...WIDTHS, current].sort((a, b) =>
							a === KEEP ? 1 : b === KEEP ? -1 : Number(a) - Number(b),
						),
			);
			setWithCaption(figure ? figure.caption !== null : true);
			setWithLabel(figure ? figure.label !== null : true);
			setError(null);
			setMode(nextMode);
			setView(target);
		};
		document.addEventListener(INSERT_FIGURE_EVENT, open);
		return () => document.removeEventListener(INSERT_FIGURE_EVENT, open);
	}, [editorRef, canUpload]);

	// A preview of the chosen image, when the browser can show it.
	useEffect(() => {
		let url: string | null = null;
		let cancelled = false;
		setPreview(null);
		const show = (blob: Blob) => {
			if (cancelled) return;
			url = URL.createObjectURL(blob);
			setPreview(url);
		};
		if (source === 'upload' && upload && canPreviewImage(upload.name)) {
			show(upload);
		} else if (source === 'project' && selected && canPreviewImage(selected)) {
			void fileStoreService.getFileByPath(selected).then((file) => {
				if (file?.content) {
					show(new Blob([file.content], { type: file.mimeType ?? '' }));
				}
			});
		}
		return () => {
			cancelled = true;
			if (url) URL.revokeObjectURL(url);
		};
	}, [source, selected, upload]);

	const close = () => {
		setView(null);
		setBusy(false);
	};

	const ready =
		mode === 'edit' || (source === 'project' ? !!selected : !!upload);

	const insert = async (target: EditorView) => {
		const path =
			source === 'upload' && upload ? await addFigureImage(upload) : selected;
		const latexPath = filePathCacheService.toCompileRelativePath(path);
		const { text, caption } = figureLatex({
			path: latexPath,
			width: Number(width),
			caption: withCaption ? t('Enter caption') : null,
			label: withLabel ? figureLabel(latexPath) : null,
		});
		close();
		insertFigure(target, text, caption);
	};

	const change = async (target: EditorView) => {
		const path =
			mode === 'replace'
				? source === 'upload' && upload
					? await addFigureImage(upload)
					: selected
				: null;
		// Read once the image is added, as collaborators may have written.
		const figure = selectedFigure(target);
		if (!figure) throw new Error(t('The figure is no longer in the document.'));
		const text = target.state.doc.toString();
		const addsCaption = withCaption && figure.caption === null;
		const changes =
			path !== null
				? setFigureImage(
						figure,
						filePathCacheService.toCompileRelativePath(path),
					)
				: [
						...(width === KEEP || Number(width) === figure.graphics.width
							? []
							: setFigureWidth(text, figure, Number(width))),
						...setFigureParts(text, figure, {
							caption: withCaption ? t('Enter caption') : null,
							label: withLabel ? figureLabel(figure.graphics.path) : null,
						}),
					];
		close();
		applyFigureChanges(target, changes, figure.from);
		// A new caption is selected, for its text to be typed.
		const caption = addsCaption ? selectedFigure(target)?.caption : null;
		if (caption) {
			target.dispatch({
				selection: {
					anchor: caption.to - 1 - caption.argument.length,
					head: caption.to - 1,
				},
			});
			target.focus();
		}
	};

	const submit = async (event: React.FormEvent) => {
		event.preventDefault();
		if (!view || !ready) return;
		setBusy(true);
		setError(null);
		try {
			await (mode === 'insert' ? insert(view) : change(view));
		} catch (caught) {
			setError(
				caught instanceof Error
					? caught.message
					: t('Could not add the image.'),
			);
			setBusy(false);
		}
	};

	const title =
		mode === 'edit'
			? t('Edit figure')
			: mode === 'replace'
				? t('Replace image')
				: t('Insert figure');

	return (
		<Modal isOpen={!!view} onClose={close} title={title} size='medium'>
			<form
				className='ui-stack insert-figure-form'
				data-gap='sm'
				data-mode={mode}
				onSubmit={submit}
			>
				{mode !== 'edit' && (
					<fieldset className='ui-stack' data-gap='xs'>
						<label>
							<input
								type='radio'
								name='figure-source'
								value='project'
								checked={source === 'project'}
								onChange={() => setSource('project')}
								disabled={images.length === 0}
							/>
							{t('From project files')}
						</label>
						{source === 'project' && (
							<select
								id='figure-project-image'
								className='ui-field-control'
								value={selected}
								onChange={(event) => setSelected(event.target.value)}
							>
								{images.map((path) => (
									<option key={path} value={path}>
										{path.replace(/^\//, '')}
									</option>
								))}
							</select>
						)}
						{images.length === 0 && (
							<p className='ui-meta'>{t('The project has no image yet.')}</p>
						)}
						{canUpload && (
							<label>
								<input
									type='radio'
									name='figure-source'
									value='upload'
									checked={source === 'upload'}
									onChange={() => setSource('upload')}
								/>
								{t('Upload from computer')}
							</label>
						)}
						{canUpload && source === 'upload' && (
							<input
								id='figure-upload'
								type='file'
								accept='.png,.jpg,.jpeg,.pdf,.eps,image/png,image/jpeg,application/pdf'
								onChange={(event) => setUpload(event.target.files?.[0] ?? null)}
							/>
						)}
					</fieldset>
				)}

				{preview && (
					<img
						className='insert-figure-preview'
						src={preview}
						alt={t('Preview')}
					/>
				)}

				{mode !== 'replace' && (
					<>
						<label htmlFor='figure-width'>{t('Width')}</label>
						<select
							id='figure-width'
							className='ui-field-control'
							value={width}
							onChange={(event) => setWidth(event.target.value)}
						>
							{widths.map((value) => (
								<option key={value} value={value}>
									{value === KEEP
										? t('Current size')
										: t('{percent}% of the line width', {
												percent: Math.round(Number(value) * 100),
											})}
								</option>
							))}
						</select>

						<label>
							<input
								id='figure-caption'
								type='checkbox'
								checked={withCaption}
								onChange={(event) => setWithCaption(event.target.checked)}
							/>
							{t('Include a caption')}
						</label>
						<label>
							<input
								id='figure-label'
								type='checkbox'
								checked={withLabel}
								onChange={(event) => setWithLabel(event.target.checked)}
							/>
							{t('Include a label')}
						</label>
					</>
				)}

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
						disabled={busy || !ready}
					>
						{mode === 'edit'
							? t('Apply')
							: mode === 'replace'
								? t('Replace')
								: t('Insert figure')}
					</button>
				</div>
			</form>
		</Modal>
	);
};

export default InsertFigureModal;
