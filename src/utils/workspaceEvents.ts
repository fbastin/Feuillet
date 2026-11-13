// src/utils/workspaceEvents.ts
// Asked of the editor's page from elsewhere, as by the command palette.
import type { EditorSidebarView } from '../types/editor';

/** Shows a side panel: detail { view } (FileDocumentController listens). */
export const OPEN_SIDEBAR_VIEW = 'open-sidebar-view';
export type OpenSidebarViewDetail = { view: EditorSidebarView };

/** Opens the settings (SettingsButton listens). */
export const OPEN_SETTINGS = 'open-settings';

/** Exports the project to Markdown (ExternalExportButton listens). */
export const EXPORT_MARKDOWN = 'export-markdown';
