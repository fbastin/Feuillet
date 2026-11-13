// src/components/editor/editorCommands.ts
// What the command palette offers in a project, as Overleaf's: compiling,
// editing and inserting in the open file, the views, review, and the
// project's files to open. Asked each time it opens, for what can be done
// then (a selection to comment, a PDF to go to…).
import { gotoLine, openSearchPanel } from '@codemirror/search';

import { t } from '@/i18n';
import {
	readVisualPreference,
	writeVisualPreference,
} from '../../extensions/codemirror/VisualLatexExtension';
import { reviewConfig } from '../../extensions/codemirror/ReviewExtension';
import { SOURCEMAP_QUERY } from '../../extensions/codemirror/editorContextMenu';
import {
	TOGGLE_REVIEW_PANEL,
	TOGGLE_TRACK_CHANGES,
	toLowerCase,
	toUpperCase,
} from '../../extensions/codemirror/overleafKeys';
import { activeEditorService } from '../../services/ActiveEditorService';
import { fileStoreService } from '../../services/FileStoreService';
import type { EditorSidebarView } from '../../types/editor';
import {
	OPEN_SETTINGS,
	OPEN_SIDEBAR_VIEW,
	type OpenSidebarViewDetail,
} from '../../utils/workspaceEvents';

export interface PaletteCommand {
	id: string;
	/** Its group, as written: Files, Editing… */
	group: string;
	label: string;
	/** Under the label: a file's folder. */
	detail?: string;
	/** Its keys, as Overleaf writes them: Ctrl+Shift+M (utils/keyLabels). */
	keys?: string;
	/** Other words that find it. */
	keywords?: string;
	/** A file of the project, ranked after the commands. */
	file?: boolean;
	run: () => void;
}

export interface EditorCommandContext {
	focusMode: boolean;
	setFocusMode: (on: boolean) => void;
	openShare: () => void;
	openShortcuts: () => void;
	backToProjects: () => void;
	/** Whether this person may change the project. */
	readOnly: boolean;
	/** A project on the server: versions, collaborators, Git. */
	online: boolean;
	isGuest: boolean;
}

const announce = (name: string, detail?: unknown) =>
	document.dispatchEvent(new CustomEvent(name, { detail }));

const sourceMapAvailable = () => {
	const query = new CustomEvent<{ available: boolean }>(SOURCEMAP_QUERY, {
		detail: { available: false },
	});
	document.dispatchEvent(query);
	return query.detail.available;
};

const showView = (view: EditorSidebarView) =>
	announce(OPEN_SIDEBAR_VIEW, { view } satisfies OpenSidebarViewDetail);

// The toolbar's own, which the editor's keys already do.
const LEFT_OUT_TOOLS = new Set(['undo', 'redo']);

export function editorCommands(
	context: EditorCommandContext,
): PaletteCommand[] {
	const groups = {
		project: t('Project'),
		editing: t('Editing'),
		insertion: t('Insertion'),
		view: t('View'),
		compiling: t('Compiling'),
		reviewing: t('Reviewing'),
	};
	const editor = activeEditorService.get();
	const view = editor?.view;
	const editable = !!view && !view.state.readOnly && !context.readOnly;
	const commands: PaletteCommand[] = [];
	const add = (command: PaletteCommand | false | undefined) => {
		if (command) commands.push(command);
	};

	// Compiling.
	add({
		id: 'compile',
		group: groups.compiling,
		label: t('Compile document'),
		keys: 'Ctrl+Enter',
		keywords: 'recompile pdf build recompiler',
		run: () => (editor ? editor.saveAndCompile() : announce('trigger-compile')),
	});
	add({
		id: 'compile-clean',
		group: groups.compiling,
		label: t('Compile with cleared cache'),
		keys: 'Shift+F9',
		keywords: 'clear cache recompile',
		run: () => announce('trigger-compile-clean'),
	});
	add({
		id: 'stop-compile',
		group: groups.compiling,
		label: t('Stop compilation'),
		keys: 'F8',
		run: () => announce('trigger-stop-compilation'),
	});

	// Editing the open file.
	if (view) {
		add({
			id: 'goto-line',
			group: groups.editing,
			label: t('Go to line'),
			keys: 'Ctrl+Shift+L',
			run: () => {
				view.focus();
				gotoLine(view);
			},
		});
		add({
			id: 'find',
			group: groups.editing,
			label: t('Find in document'),
			keys: 'Ctrl+F',
			keywords: 'search replace',
			run: () => {
				view.focus();
				openSearchPanel(view);
			},
		});
		add(
			editable && {
				id: 'upper-case',
				group: groups.editing,
				label: t('To upper case'),
				keys: 'Ctrl+U',
				run: () => {
					view.focus();
					toUpperCase(view);
				},
			},
		);
		add(
			editable && {
				id: 'lower-case',
				group: groups.editing,
				label: t('To lower case'),
				keys: 'Ctrl+Shift+U',
				run: () => {
					view.focus();
					toLowerCase(view);
				},
			},
		);
		add(
			editable &&
				['latex', 'typst', 'bib'].includes(editor.fileType) && {
					id: 'format',
					group: groups.editing,
					label: t('Format document'),
					// Control on a Mac too.
					keys: 'Control+Shift+I',
					keywords: 'indent tidy',
					run: () => {
						view.focus();
						editor.format();
					},
				},
		);
	}

	// Review.
	const review = view?.state.field(reviewConfig, false);
	const selection = view?.state.selection.main;
	add(
		!!view &&
			editor?.comments &&
			selection &&
			!selection.empty && {
				id: 'comment',
				group: groups.reviewing,
				label: t('Add comment'),
				keys: 'Ctrl+Shift+C',
				run: () => {
					view.focus();
					announce('show-comment-modal', {
						selection: { from: selection.from, to: selection.to },
					});
				},
			},
	);
	add(
		!!review && {
			id: 'review-panel',
			group: groups.reviewing,
			label: t('Show or hide the review panel'),
			keys: 'Ctrl+J',
			keywords: 'comments tracked changes',
			run: () => announce(TOGGLE_REVIEW_PANEL),
		},
	);
	add(
		!!review?.canDecide &&
			editable && {
				id: 'track-changes',
				group: groups.reviewing,
				label: t('Turn track changes on or off'),
				keys: 'Ctrl+Shift+A',
				keywords: 'suggest suggestions',
				run: () => announce(TOGGLE_TRACK_CHANGES),
			},
	);
	add(
		context.online && {
			id: 'review-overview',
			group: groups.reviewing,
			label: t('Show the review overview'),
			run: () => showView('review'),
		},
	);

	// The views.
	add({
		id: 'focus-mode',
		group: groups.view,
		label: context.focusMode ? t('Leave focus mode') : t('Focus mode'),
		keys: 'Ctrl+Shift+M',
		keywords: 'zen distraction',
		run: () => context.setFocusMode(!context.focusMode),
	});
	add(
		editor?.fileType === 'latex' && {
			id: 'visual-editor',
			group: groups.view,
			label: readVisualPreference() ? t('Code editor') : t('Visual editor'),
			keywords: 'visual code rich text',
			run: () => {
				writeVisualPreference(!readVisualPreference());
				view?.focus();
			},
		},
	);
	add(
		sourceMapAvailable() && {
			id: 'jump-to-pdf',
			group: groups.view,
			label: t('Jump to location in PDF'),
			keywords: 'synctex',
			run: () => announce('trigger-sourcemap-forward'),
		},
	);
	add({
		id: 'show-files',
		group: groups.view,
		label: t('Show the files'),
		keywords: 'file tree',
		run: () => showView('files'),
	});
	add({
		id: 'search-project',
		group: groups.view,
		label: t('Open search panel'),
		keys: 'Ctrl+Shift+F',
		keywords: 'find project',
		run: () =>
			announce('open-search-panel', { mode: 'search', selectedText: '' }),
	});
	add(
		!context.readOnly && {
			id: 'replace-project',
			group: groups.view,
			label: t('Open search and replace panel'),
			keys: 'Ctrl+Shift+H',
			run: () =>
				announce('open-search-panel', { mode: 'replace', selectedText: '' }),
		},
	);
	add({
		id: 'settings',
		group: groups.view,
		label: t('Settings'),
		keywords: 'preferences font theme',
		run: () => announce(OPEN_SETTINGS),
	});
	add({
		id: 'shortcuts',
		group: groups.view,
		label: t('Keyboard Shortcuts'),
		keywords: 'keys',
		run: context.openShortcuts,
	});

	// The project.
	add(
		context.online && {
			id: 'share',
			group: groups.project,
			label: t('Share'),
			keywords: 'invite collaborators link',
			run: context.openShare,
		},
	);
	add(
		context.online && {
			id: 'show-collaborators',
			group: groups.project,
			label: t('Show the collaborators'),
			keywords: 'people',
			run: () => showView('people'),
		},
	);
	add(
		context.online && {
			id: 'show-versions',
			group: groups.project,
			label: t('Show the versions'),
			keywords: 'history restore compare',
			run: () => showView('versions'),
		},
	);
	add(
		!context.isGuest && {
			id: 'show-git-history',
			group: groups.project,
			label: t('Show the Git history'),
			keywords: 'commits github',
			run: () => showView('history'),
		},
	);
	add({
		id: 'projects',
		group: groups.project,
		label: t('Back to Projects'),
		keywords: 'project list',
		run: context.backToProjects,
	});

	// What the editor's toolbar inserts: many, after the others.
	const tools = editor && editable ? (editor.toolbar()?.getItems() ?? []) : [];
	for (const tool of tools) {
		if ('type' in tool || LEFT_OUT_TOOLS.has(tool.key)) continue;
		add({
			id: `tool:${tool.key}`,
			group: groups.insertion,
			label: tool.label,
			run: () => {
				view?.focus();
				editor?.toolbar()?.run(tool.key);
			},
		});
	}

	return commands;
}

/** The project's files, to open one. */
export async function fileCommands(): Promise<PaletteCommand[]> {
	const files = await fileStoreService.getAllFiles(false, false, false);
	const group = t('Files');
	return files
		.filter((file) => file.type === 'file' && !file.isDeleted)
		.sort((a, b) => a.path.localeCompare(b.path))
		.map((file) => {
			const folder = file.path.slice(0, file.path.length - file.name.length);
			return {
				id: `file:${file.path}`,
				group,
				label: file.name,
				detail: folder.replace(/^\/|\/$/g, '') || undefined,
				file: true,
				run: () =>
					announce('navigate-to-compiled-file', { filePath: file.path }),
			};
		});
}
