// src/types/spelling.ts
export type SpellingLanguage = 'fr' | 'en-US' | 'en-GB';

// 'auto' follows the language the document declares, then the language its
// text is written in, then the interface language.
export type SpellingSetting = 'auto' | 'off' | SpellingLanguage;
