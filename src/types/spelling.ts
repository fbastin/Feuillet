// src/types/spelling.ts
export type SpellingLanguage = 'fr' | 'en-US' | 'en-GB';

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
