// src/services/SpellingService.ts
import { createNamedLogger } from '@/logging';
import type {
	SpellingReply,
	SpellingRequest,
} from '../extensions/codemirror/spelling/spelling.worker';
import type { SpellingLanguage } from '../types/spelling';

const moduleLog = createNamedLogger('SpellingService');

const LEARNED_WORDS_KEY = 'feuillet-spelling-dictionary';

type Request =
	| { type: 'check'; words: string[] }
	| { type: 'suggest'; word: string };

// Checks words against Hunspell dictionaries in a worker and remembers the
// answers. Also keeps the words added to the user's own dictionary.
class SpellingService {
	private worker: Worker | null = null;
	private nextId = 1;
	private pending = new Map<
		number,
		{ resolve: (result: string[]) => void; reject: (error: Error) => void }
	>();
	private answers = new Map<SpellingLanguage, Map<string, boolean>>();
	private learned: Set<string> | null = null;
	private listeners = new Set<() => void>();

	// Whether `word` is misspelled, or undefined when it was not checked yet.
	isMisspelled(language: SpellingLanguage, word: string): boolean | undefined {
		if (this.isLearned(word)) return false;
		const correct = this.answers.get(language)?.get(word);
		return correct === undefined ? undefined : !correct;
	}

	// Checks the words that were not checked yet.
	async check(language: SpellingLanguage, words: Iterable<string>) {
		let answers = this.answers.get(language);
		if (!answers) {
			answers = new Map();
			this.answers.set(language, answers);
		}
		const unknown = [...new Set(words)].filter((word) => !answers.has(word));
		if (!unknown.length) return;

		const misspelled = new Set(
			await this.request(language, { type: 'check', words: unknown }),
		);
		for (const word of unknown) answers.set(word, !misspelled.has(word));
	}

	suggest(language: SpellingLanguage, word: string): Promise<string[]> {
		return this.request(language, { type: 'suggest', word });
	}

	isLearned(word: string): boolean {
		const learned = this.learnedWords();
		return learned.has(word) || learned.has(word.toLowerCase());
	}

	learnWord(word: string): void {
		this.learnedWords().add(word);
		this.saveLearnedWords();
	}

	forgetWord(word: string): void {
		const learned = this.learnedWords();
		learned.delete(word);
		learned.delete(word.toLowerCase());
		this.saveLearnedWords();
	}

	addListener(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private learnedWords(): Set<string> {
		if (!this.learned) {
			try {
				const stored = JSON.parse(
					localStorage.getItem(LEARNED_WORDS_KEY) ?? '[]',
				);
				this.learned = new Set(Array.isArray(stored) ? stored : []);
			} catch {
				this.learned = new Set();
			}
		}
		return this.learned;
	}

	private saveLearnedWords(): void {
		try {
			localStorage.setItem(
				LEARNED_WORDS_KEY,
				JSON.stringify([...this.learnedWords()].sort()),
			);
		} catch (error) {
			moduleLog.warn('Could not save the personal dictionary:', error);
		}
		this.listeners.forEach((listener) => {
			listener();
		});
	}

	private request(language: SpellingLanguage, request: Request) {
		const id = this.nextId++;
		const message = { id, language, ...request } as SpellingRequest;
		return new Promise<string[]>((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			this.getWorker().postMessage(message);
		});
	}

	private getWorker(): Worker {
		if (this.worker) return this.worker;

		const worker = new Worker(
			new URL(
				'../extensions/codemirror/spelling/spelling.worker.ts',
				import.meta.url,
			),
			{ type: 'module' },
		);
		worker.addEventListener('message', (event: MessageEvent<SpellingReply>) => {
			const reply = event.data;
			const pending = this.pending.get(reply.id);
			if (!pending) return;
			this.pending.delete(reply.id);
			if ('error' in reply) pending.reject(new Error(reply.error));
			else pending.resolve(reply.result);
		});
		worker.addEventListener('error', (event) => {
			moduleLog.error('Spelling worker failed:', event.message);
			const error = new Error(event.message || 'Spelling worker failed');
			for (const pending of this.pending.values()) pending.reject(error);
			this.pending.clear();
			worker.terminate();
			if (this.worker === worker) this.worker = null;
		});
		this.worker = worker;
		return worker;
	}
}

export const spellingService = new SpellingService();
