// src/extensions/codemirror/spelling/spelling.worker.ts
// Checks words with Hunspell, away from the editor's thread.
import { createHunspellFromStrings, type Hunspell } from 'hunspell-wasm';

import type { SpellingLanguage } from '../../../types/spelling';

export type SpellingRequest =
	| { id: number; type: 'check'; language: SpellingLanguage; words: string[] }
	| { id: number; type: 'suggest'; language: SpellingLanguage; word: string };

export type SpellingReply =
	| { id: number; result: string[] }
	| { id: number; error: string };

// Each dictionary is a chunk of its own, loaded the first time its language
// is checked.
const DICTIONARIES: Record<
	SpellingLanguage,
	() => Promise<{ default: string }[]>
> = {
	fr: () =>
		Promise.all([
			import('@dictionaries/dictionary-fr/index.aff?raw'),
			import('@dictionaries/dictionary-fr/index.dic?raw'),
		]),
	'en-US': () =>
		Promise.all([
			import('@dictionaries/dictionary-en/index.aff?raw'),
			import('@dictionaries/dictionary-en/index.dic?raw'),
		]),
	'en-GB': () =>
		Promise.all([
			import('@dictionaries/dictionary-en-gb/index.aff?raw'),
			import('@dictionaries/dictionary-en-gb/index.dic?raw'),
		]),
	// From wooorm/dictionaries: German (Germany), Spanish, Italian,
	// Portuguese of Brazil and of Portugal, Dutch, Catalan, Polish, Russian,
	// Swedish, Danish and Romanian (licenses in the README).
	de: () =>
		Promise.all([
			import('@dictionaries/dictionary-de/index.aff?raw'),
			import('@dictionaries/dictionary-de/index.dic?raw'),
		]),
	es: () =>
		Promise.all([
			import('@dictionaries/dictionary-es/index.aff?raw'),
			import('@dictionaries/dictionary-es/index.dic?raw'),
		]),
	it: () =>
		Promise.all([
			import('@dictionaries/dictionary-it/index.aff?raw'),
			import('@dictionaries/dictionary-it/index.dic?raw'),
		]),
	'pt-BR': () =>
		Promise.all([
			import('@dictionaries/dictionary-pt/index.aff?raw'),
			import('@dictionaries/dictionary-pt/index.dic?raw'),
		]),
	'pt-PT': () =>
		Promise.all([
			import('@dictionaries/dictionary-pt-pt/index.aff?raw'),
			import('@dictionaries/dictionary-pt-pt/index.dic?raw'),
		]),
	nl: () =>
		Promise.all([
			import('@dictionaries/dictionary-nl/index.aff?raw'),
			import('@dictionaries/dictionary-nl/index.dic?raw'),
		]),
	ca: () =>
		Promise.all([
			import('@dictionaries/dictionary-ca/index.aff?raw'),
			import('@dictionaries/dictionary-ca/index.dic?raw'),
		]),
	pl: () =>
		Promise.all([
			import('@dictionaries/dictionary-pl/index.aff?raw'),
			import('@dictionaries/dictionary-pl/index.dic?raw'),
		]),
	ru: () =>
		Promise.all([
			import('@dictionaries/dictionary-ru/index.aff?raw'),
			import('@dictionaries/dictionary-ru/index.dic?raw'),
		]),
	sv: () =>
		Promise.all([
			import('@dictionaries/dictionary-sv/index.aff?raw'),
			import('@dictionaries/dictionary-sv/index.dic?raw'),
		]),
	da: () =>
		Promise.all([
			import('@dictionaries/dictionary-da/index.aff?raw'),
			import('@dictionaries/dictionary-da/index.dic?raw'),
		]),
	ro: () =>
		Promise.all([
			import('@dictionaries/dictionary-ro/index.aff?raw'),
			import('@dictionaries/dictionary-ro/index.dic?raw'),
		]),
};

const MAX_SUGGESTIONS = 8;
// Elisions, like « l'électricité », « dell'anno » or « d'aquesta »:
// suggestions are made for the word after the apostrophe.
const ELISION = /^(\p{L}{1,7}['’])(.+)$/u;
const ELIDING: ReadonlySet<string> = new Set(['fr', 'it', 'ca']);

const spellers = new Map<SpellingLanguage, Promise<Hunspell>>();

const spellerFor = (language: SpellingLanguage) => {
	let speller = spellers.get(language);
	if (!speller) {
		speller = DICTIONARIES[language]().then(([affixes, words]) =>
			createHunspellFromStrings(affixes.default, words.default),
		);
		speller.catch(() => spellers.delete(language));
		spellers.set(language, speller);
	}
	return speller;
};

const suggestionsFor = (speller: Hunspell, language: string, word: string) => {
	const elision = ELIDING.has(language) ? ELISION.exec(word) : null;
	const suggestions = elision
		? speller
				.getSpellingSuggestions(elision[2])
				.map((suggestion) => elision[1] + suggestion)
		: speller.getSpellingSuggestions(word);
	return suggestions.slice(0, MAX_SUGGESTIONS);
};

self.addEventListener(
	'message',
	async (event: MessageEvent<SpellingRequest>) => {
		const request = event.data;
		let reply: SpellingReply;
		try {
			const speller = await spellerFor(request.language);
			reply = {
				id: request.id,
				result:
					request.type === 'check'
						? request.words.filter((word) => !speller.testSpelling(word))
						: suggestionsFor(speller, request.language, request.word),
			};
		} catch (error) {
			reply = {
				id: request.id,
				error: error instanceof Error ? error.message : String(error),
			};
		}
		self.postMessage(reply);
	},
);
