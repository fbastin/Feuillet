// src/components/editor/VisualEditorToggle.tsx
import type { EditorView } from '@codemirror/view';
import type React from 'react';
import { useEffect, useState } from 'react';

import { t } from '@/i18n';
import {
	onVisualPreferenceChange,
	readVisualPreference,
	setVisualMode,
	writeVisualPreference,
} from '../../extensions/codemirror/VisualLatexExtension';
import { PluginControlGroup } from '../common/PluginHeader';

interface VisualEditorToggleProps {
	viewRef: React.RefObject<EditorView | null>;
}

/**
 * Switches LaTeX documents between the code and the visual editor, as on
 * Overleaf; the choice is remembered in this browser.
 */
const VisualEditorToggle: React.FC<VisualEditorToggleProps> = ({ viewRef }) => {
	const [visual, setVisual] = useState(readVisualPreference);

	// Other open editors follow the choice.
	useEffect(
		() =>
			onVisualPreferenceChange((value) => {
				setVisual(value);
				viewRef.current?.dispatch({ effects: setVisualMode.of(value) });
			}),
		[viewRef],
	);

	const choose = (value: boolean) => {
		if (value === visual) return;
		writeVisualPreference(value);
		viewRef.current?.focus();
	};

	return (
		<PluginControlGroup>
			<button
				type='button'
				className={`button ${visual ? '' : 'active'}`}
				aria-pressed={!visual}
				title={t('Code editor')}
				onClick={() => choose(false)}
			>
				{t('Code')}
			</button>
			<button
				type='button'
				className={`button ${visual ? 'active' : ''}`}
				aria-pressed={visual}
				title={t('Visual editor')}
				onClick={() => choose(true)}
			>
				{t('Visual')}
			</button>
		</PluginControlGroup>
	);
};

export default VisualEditorToggle;
