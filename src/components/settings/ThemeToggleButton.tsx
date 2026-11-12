// src/components/settings/ThemeToggleButton.tsx
import type React from 'react';
import { useEffect, useRef } from 'react';

import { t } from '@/i18n';
import { useProperties } from '../../hooks/useProperties';
import { useSettings } from '../../hooks/useSettings';
import { useTheme } from '../../hooks/useTheme';
import { SunIcon, MoonIcon } from '../common/Icons';

interface ThemeToggleButtonProps {
	className?: string;
}

const ThemeToggleButton: React.FC<ThemeToggleButtonProps> = ({
	className = '',
}) => {
	const { updateSetting } = useSettings();
	const { getProperty, registerProperty } = useProperties();
	const { isCurrentVariantDark } = useTheme();
	const propertiesRegistered = useRef(false);

	useEffect(() => {
		if (propertiesRegistered.current) return;
		propertiesRegistered.current = true;

		registerProperty({
			id: 'theme-toggle-light',
			category: 'Theme',
			subcategory: 'Toggle',
			defaultValue: 'feuillet_light',
		});
		registerProperty({
			id: 'theme-toggle-dark',
			category: 'Theme',
			subcategory: 'Toggle',
			defaultValue: 'feuillet_dark',
		});
	}, [registerProperty]);

	const lightVariant =
		(getProperty('theme-toggle-light') as string) || 'feuillet_light';
	const darkVariant =
		(getProperty('theme-toggle-dark') as string) || 'feuillet_dark';

	// Whether the palette shown is dark, whichever it is: from another dark
	// one (Monokai, Nord...), the button goes to the light one.
	const isDark = isCurrentVariantDark;

	const toggleTheme = () => {
		updateSetting('theme-variant', isDark ? lightVariant : darkVariant);
	};

	return (
		<button
			type='button'
			className={`${className} ui-icon-button`}
			data-variant='subtle'
			onClick={toggleTheme}
			title={t('Switch to {theme}', {
				theme: isDark ? t('Light Theme') : t('Dark Theme'),
			})}
		>
			{isDark ? <SunIcon /> : <MoonIcon />}
		</button>
	);
};

export default ThemeToggleButton;
