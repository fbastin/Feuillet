// src/i18n.ts
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

import { APP_NAME, UPSTREAM_NAME } from './branding';

import enTranslations from '../translations/locales/en.json';
import deTranslations from '../translations/locales/de.json';
import itTranslations from '../translations/locales/it.json';
import arTranslations from '../translations/locales/ar.json';
import zhCNTranslations from '../translations/locales/zh-CN.json';

// Forks rename the app through texlyre.config.ts `title`. Rewriting the
// translated output keeps the upstream translation keys and locales usable.
const UPSTREAM_NAME_PATTERN = new RegExp(`\\b${UPSTREAM_NAME}\\b`, 'g');
const rebrand = APP_NAME !== UPSTREAM_NAME;

i18next.use({
	type: 'postProcessor',
	name: 'appName',
	process: (value: string) =>
		rebrand ? value.replace(UPSTREAM_NAME_PATTERN, APP_NAME) : value,
});

i18next.use(initReactI18next).init({
	resources: {
		en: {
			translation: enTranslations,
		},
		de: {
			translation: deTranslations,
		},
		it: {
			translation: itTranslations,
		},
		ar: {
			translation: arTranslations,
		},
		// 'zh-CN': {
		//     translation: zhCNTranslations,
		// },
		zh: {
			translation: zhCNTranslations,
		},
	},
	lng: 'en',
	fallbackLng: 'en',
	interpolation: {
		escapeValue: false,
	},
	postProcess: ['appName'],
});

export const t = (
	key: string,
	options?: { count?: number; [key: string]: any },
): string => {
	return i18next.t(key, options) as string;
};

export default i18next;
