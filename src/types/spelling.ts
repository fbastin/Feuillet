// src/types/spelling.ts
// The languages Feuillet has a dictionary for (spelling.worker.ts), as
// Overleaf offers many.
export const SPELLING_LANGUAGES = [
	'fr',
	'en-US',
	'en-GB',
	'de',
	'es',
	'it',
	'pt-BR',
	'pt-PT',
	'nl',
	'ca',
	'pl',
	'ru',
	'sv',
	'da',
	'ro',
] as const;

export type SpellingLanguage = (typeof SPELLING_LANGUAGES)[number];

// 'auto' follows the language the document declares, then the language its
// text is written in, then the interface language.
export type SpellingSetting = 'auto' | 'off' | SpellingLanguage;

// A word of the user's own dictionary. A removed word stays as a deletion,
// so that the user's other devices remove it too.
export interface DictionaryEntry {
	word: string;
	updatedAt: number;
	deleted?: true;
}
