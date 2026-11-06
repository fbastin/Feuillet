// src/extensions/codemirror/editorPhrases.ts
// CodeMirror's own words, in the interface's language: the search panel
// (Ctrl+F) showed « Find », « Replace », « all », and folding and the lists
// of suggestions their English titles. Built when an editor is, once the
// translations are loaded; with the search panel's tooltips and icon.
import { EditorState, type Extension } from '@codemirror/state';

import { t } from '@/i18n';
import { searchPanelLabels } from './searchPanelLabels';

export const editorPhrases = (): Extension => [
	searchPanelLabels,
	EditorState.phrases.of({
		// @codemirror/search
		Find: t('Find'),
		Replace: t('Replace'),
		next: t('Next'),
		previous: t('Previous'),
		all: t('Select all matches'),
		'match case': t('Match case'),
		regexp: t('Regular expression'),
		'by word': t('Match whole word'),
		replace: t('Replace'),
		'replace all': t('Replace all'),
		close: t('Close'),
		'current match': t('current match'),
		'on line': t('on line'),
		'replaced $ matches': t('replaced $ matches'),
		'replaced match on line $': t('replaced match on line $'),
		'Go to line': t('Go to line'),
		go: t('Go'),
		// @codemirror/language
		'Fold line': t('Fold line'),
		'Unfold line': t('Unfold line'),
		'Folded lines': t('Folded lines'),
		'Unfolded lines': t('Unfolded lines'),
		to: t('to'),
		'folded code': t('folded code'),
		unfold: t('unfold'),
		// @codemirror/autocomplete, @codemirror/lint, @codemirror/view
		Completions: t('Completions'),
		Diagnostics: t('Diagnostics'),
		'No diagnostics': t('No diagnostics'),
		'Control character': t('Control character'),
	}),
];
