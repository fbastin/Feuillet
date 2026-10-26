// src/services/PersonalDictionaryService.ts
import { createNamedLogger } from '@/logging';
import type { DictionaryEntry } from '../types/spelling';

const moduleLog = createNamedLogger('PersonalDictionaryService');

// Where words went before each user had a dictionary of their own.
const BROWSER_KEY = 'feuillet-spelling-dictionary';
const userKey = (userId: string) => `feuillet-spelling-dictionary-${userId}`;

export type DictionaryListener = (userId: string, local: boolean) => void;

// Accepts the entries of another device or of the account server.
export const cleanDictionaryEntry = (
	entry: unknown,
): DictionaryEntry | null => {
	if (!entry || typeof entry !== 'object') return null;
	const { word, updatedAt, deleted } = entry as Record<string, unknown>;
	if (typeof word !== 'string' || !word || word.length > 100) return null;
	if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) return null;
	return deleted === true ? { word, updatedAt, deleted } : { word, updatedAt };
};

// The words each user added to their own dictionary. Removed words are kept
// as deletions, so that the account server can bring every device in step.
class PersonalDictionaryService {
	private currentUserId: () => string | null = () => null;
	private cache: {
		userId: string;
		entries: Map<string, DictionaryEntry>;
	} | null = null;
	private listeners = new Set<DictionaryListener>();

	followUser(currentUserId: () => string | null): void {
		this.currentUserId = currentUserId;
	}

	has(word: string): boolean {
		const userId = this.currentUserId();
		if (!userId) return false;
		const entries = this.load(userId);
		return [word, word.toLowerCase()].some((candidate) => {
			const entry = entries.get(candidate);
			return entry !== undefined && !entry.deleted;
		});
	}

	add(word: string): void {
		this.change([word], false);
	}

	// Removes the word, and its lower-case form that also accepts it.
	remove(word: string): void {
		this.change([...new Set([word, word.toLowerCase()])], true);
	}

	entries(userId: string): DictionaryEntry[] {
		return [...this.load(userId).values()];
	}

	// Takes the most recent version of each word; a deletion wins a tie.
	merge(userId: string, incoming: unknown[]): void {
		const entries = this.load(userId);
		let changed = false;
		for (const raw of incoming) {
			const entry = cleanDictionaryEntry(raw);
			if (!entry) continue;
			const current = entries.get(entry.word);
			if (
				!current ||
				entry.updatedAt > current.updatedAt ||
				(entry.updatedAt === current.updatedAt &&
					entry.deleted &&
					!current.deleted)
			) {
				entries.set(entry.word, entry);
				changed = true;
			}
		}
		if (!changed) return;
		this.save(userId, entries);
		this.notify(userId, false);
	}

	// A guest who creates an account keeps their words.
	transfer(fromUserId: string, toUserId: string): void {
		const raw = localStorage.getItem(userKey(fromUserId));
		if (raw !== null) localStorage.setItem(userKey(toUserId), raw);
		this.forget(fromUserId);
	}

	forget(userId: string): void {
		localStorage.removeItem(userKey(userId));
		if (this.cache?.userId === userId) this.cache = null;
	}

	addListener(listener: DictionaryListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private change(words: string[], deleted: boolean): void {
		const userId = this.currentUserId();
		if (!userId) return;
		const entries = this.load(userId);
		const updatedAt = Date.now();
		for (const word of words) {
			if (deleted && !entries.has(word)) continue;
			entries.set(
				word,
				deleted ? { word, updatedAt, deleted: true } : { word, updatedAt },
			);
		}
		this.save(userId, entries);
		this.notify(userId, true);
	}

	private load(userId: string): Map<string, DictionaryEntry> {
		if (this.cache?.userId === userId) return this.cache.entries;

		const entries = new Map<string, DictionaryEntry>();
		try {
			const stored = JSON.parse(localStorage.getItem(userKey(userId)) ?? '[]');
			for (const raw of Array.isArray(stored) ? stored : []) {
				const entry = cleanDictionaryEntry(raw);
				if (entry) entries.set(entry.word, entry);
			}
		} catch (error) {
			moduleLog.warn('Could not read the personal dictionary:', error);
		}
		this.cache = { userId, entries };

		// Words added in this browser before dictionaries had owners go to
		// the first user who opens their dictionary.
		const browserWords = localStorage.getItem(BROWSER_KEY);
		if (browserWords !== null) {
			try {
				const updatedAt = Date.now();
				for (const word of JSON.parse(browserWords)) {
					if (typeof word === 'string' && !entries.has(word)) {
						entries.set(word, { word, updatedAt });
					}
				}
				this.save(userId, entries);
			} catch (error) {
				moduleLog.warn('Could not move the browser dictionary:', error);
			}
			localStorage.removeItem(BROWSER_KEY);
		}
		return entries;
	}

	private save(userId: string, entries: Map<string, DictionaryEntry>): void {
		try {
			localStorage.setItem(
				userKey(userId),
				JSON.stringify(
					[...entries.values()].sort((a, b) => a.word.localeCompare(b.word)),
				),
			);
		} catch (error) {
			moduleLog.warn('Could not save the personal dictionary:', error);
		}
	}

	private notify(userId: string, local: boolean): void {
		this.listeners.forEach((listener) => {
			listener(userId, local);
		});
	}
}

export const personalDictionaryService = new PersonalDictionaryService();
