// src/settings/registerProjectListSettings.ts
import { useEffect, useRef } from 'react';

import { t } from '@/i18n';
import { useSettings } from '../hooks/useSettings';
import { TAG_COLORS_SETTING, cleanTagColors } from '../utils/tagColors';

export function useRegisterProjectListSettings() {
	const { registerSetting, batchGetSettings } = useSettings();
	const registered = useRef(false);

	useEffect(() => {
		if (registered.current) return;
		registered.current = true;

		const stored = batchGetSettings([TAG_COLORS_SETTING])[TAG_COLORS_SETTING];

		// Chosen from the project list (TagColorsModal), not here.
		registerSetting({
			id: TAG_COLORS_SETTING,
			category: t('Appearance'),
			type: 'custom',
			label: t('Tag colors'),
			defaultValue: cleanTagColors(stored),
			liveUpdate: true,
			hidden: true,
		});
	}, [registerSetting, batchGetSettings]);
}
