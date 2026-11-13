// src/types/editor.ts
import type { SpellingSetting } from './spelling';

export type FontFamily =
	| 'monospace'
	| 'serif'
	| 'sans-serif'
	| 'fira-code'
	| 'dejavu-mono'
	| 'libertinus-mono'
	| 'opendyslexic-mono'
	| 'new-computer-modern'
	| 'ibm-plex-serif'
	| 'ibm-plex-sans'
	| 'literata';

export type FontSize = number;

export type EditorKeymapMode = 'vim' | 'helix' | 'emacs' | null;

export type HighlightTheme =
	| 'auto'
	| 'light'
	| 'dark'
	| 'abcdef'
	| 'abyss'
	| 'androidstudio'
	| 'andromeda'
	| 'atomone'
	| 'aura'
	| 'basicLight'
	| 'basicDark'
	| 'bbedit'
	| 'bespin'
	| 'copilot'
	| 'darcula'
	| 'dracula'
	| 'duotoneDark'
	| 'duotoneLight'
	| 'eclipse'
	| 'githubLight'
	| 'githubDark'
	| 'gruvboxDark'
	| 'kimbie'
	| 'materialDark'
	| 'materialLight'
	| 'monokai'
	| 'monokaiDimmed'
	| 'noctisLilac'
	| 'nord'
	| 'okaidia'
	| 'quietlight'
	| 'red'
	| 'solarizedLight'
	| 'solarizedDark'
	| 'sublime'
	| 'tokyoNight'
	| 'tokyoNightStorm'
	| 'tokyoNightDay'
	| 'tomorrowNightBlue'
	| 'vscodeDark'
	| 'vscodeLight'
	| 'whiteLight'
	| 'whiteDark'
	| 'xcodeDark'
	| 'xcodeLight';

export interface LanguageFeatureSettings {
	builtinTooltips: boolean;
	builtinDiagnostics: boolean;
	builtinCompletion: boolean;
	builtinOutline: boolean;
	lspTooltips: boolean;
	lspDiagnostics: boolean;
	lspCompletion: boolean;
	lspHighlighting: boolean;
	lspOutline: boolean;
	lspSymbolHighlights: boolean;
	lspNavigation: boolean;
}

export type EditorLineHeight = 'compact' | 'normal' | 'wide';

export interface EditorSettings {
	fontSize: FontSize;
	fontFamily: FontFamily;
	showLineNumbers: boolean;
	/** Space between lines, as Overleaf's « Line height ». */
	lineHeight: EditorLineHeight;
	autoIndent: boolean;
	/** Closing brackets, braces and quotes typed with the opening ones. */
	closeBrackets: boolean;
	syntaxHighlighting: boolean;
	languageFeatures: LanguageFeatureSettings;
	autoSaveEnabled: boolean;
	autoSaveDelay: number;
	highlightTheme: HighlightTheme;
	keymapMode: EditorKeymapMode;
	spellCheck: boolean;
	spellingLanguage: SpellingSetting;
	/** Grammar and style checking (LanguageTool), when the server offers it. */
	grammarCheck: boolean;
	mathLiveEnabled: boolean;
	mathLivePreviewMode: 'hover-cursor' | 'hover' | 'cursor' | 'never';
	language: string;
	textDirection: 'auto' | 'ltr' | 'rtl';
}

export type EditorSidebarView =
	// The documents' list, no longer shown: opening one shows the files.
	| 'documents'
	| 'people'
	| 'files'
	| 'search'
	| 'review'
	| 'versions'
	| 'history';

export interface LinkedFileInfo {
	fileName: string;
	filePath: string;
	fileId: string;
	mimeType?: string;
}

export type LinkedFileInfoState = Partial<LinkedFileInfo>;
