// src/utils/commandSearch.ts
// How the command palette finds what is typed: each word of the query, in
// any order, accents and case aside; at the start of a word it counts most,
// inside one less, as letters scattered in order least. Gives where it was
// found, to show it.

export interface TextMatch {
	score: number;
	/** [from, to) in the text's characters (code points). */
	ranges: [number, number][];
}

const foldChar = (char: string): string =>
	char.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().charAt(0) || char;

const foldChars = (text: string): string[] => Array.from(text, foldChar);

const isWordChar = (char: string | undefined): boolean =>
	!!char && /[\p{L}\p{N}]/u.test(char);

// A word starts after a separator, or at a capital after a small letter
// (« mainFile »).
const startsWord = (chars: string[], original: string[], at: number): boolean =>
	at === 0 ||
	!isWordChar(chars[at - 1]) ||
	(/\p{Lu}/u.test(original[at]) && /\p{Ll}/u.test(original[at - 1]));

const indexOf = (chars: string[], word: string[], from: number): number => {
	outer: for (let i = from; i + word.length <= chars.length; i++) {
		for (let j = 0; j < word.length; j++) {
			if (chars[i + j] !== word[j]) continue outer;
		}
		return i;
	}
	return -1;
};

const matchWord = (
	chars: string[],
	original: string[],
	word: string[],
): { score: number; ranges: [number, number][] } | null => {
	let inside = -1;
	for (let at = indexOf(chars, word, 0); at >= 0; ) {
		if (startsWord(chars, original, at)) {
			return {
				score: 100 - Math.min(at, 40) * 0.5,
				ranges: [[at, at + word.length]],
			};
		}
		if (inside < 0) inside = at;
		at = indexOf(chars, word, at + 1);
	}
	if (inside >= 0) {
		return {
			score: 60 - Math.min(inside, 40) * 0.5,
			ranges: [[inside, inside + word.length]],
		};
	}
	// Scattered: each letter after the last, the first at a word's start.
	if (word.length < 2) return null;
	const ranges: [number, number][] = [];
	let at = -1;
	for (let i = 0; i < chars.length && at < 0; i++) {
		if (chars[i] === word[0] && startsWord(chars, original, i)) at = i;
	}
	if (at < 0) return null;
	let gaps = 0;
	let last = at;
	ranges.push([at, at + 1]);
	for (let j = 1; j < word.length; j++) {
		let next = -1;
		for (let i = last + 1; i < chars.length; i++) {
			if (chars[i] === word[j]) {
				next = i;
				break;
			}
		}
		if (next < 0) return null;
		gaps += next - last - 1;
		const previous = ranges[ranges.length - 1];
		if (previous[1] === next) previous[1] = next + 1;
		else ranges.push([next, next + 1]);
		last = next;
	}
	return { score: Math.max(5, 30 - gaps), ranges };
};

const mergeRanges = (ranges: [number, number][]): [number, number][] => {
	const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
	const merged: [number, number][] = [];
	for (const range of sorted) {
		const last = merged[merged.length - 1];
		if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
		else merged.push([range[0], range[1]]);
	}
	return merged;
};

/** Where `query` is found in `text`, or null; an empty query, everywhere. */
export function matchText(query: string, text: string): TextMatch | null {
	const words = query.trim().split(/\s+/).filter(Boolean).map(foldChars);
	if (words.length === 0) return { score: 0, ranges: [] };
	const original = Array.from(text);
	const chars = foldChars(text);
	let score = 0;
	const ranges: [number, number][] = [];
	for (const word of words) {
		const found = matchWord(chars, original, word);
		if (!found) return null;
		score += found.score;
		ranges.push(...found.ranges);
	}
	// The whole query as the text's beginning: what was meant.
	const whole = foldChars(query.trim());
	if (indexOf(chars, whole, 0) === 0) score += 40;
	// Shorter texts first, for the same words.
	score -= Math.min(chars.length, 80) * 0.1;
	return { score, ranges: mergeRanges(ranges) };
}

/** `text` cut into pieces, those of `ranges` marked, to show a match. */
export function highlightPieces(
	text: string,
	ranges: [number, number][],
): { text: string; match: boolean; at: number }[] {
	const chars = Array.from(text);
	const pieces: { text: string; match: boolean; at: number }[] = [];
	let at = 0;
	for (const [from, to] of ranges) {
		if (from > at) {
			pieces.push({ text: chars.slice(at, from).join(''), match: false, at });
		}
		pieces.push({
			text: chars.slice(from, to).join(''),
			match: true,
			at: from,
		});
		at = to;
	}
	if (at < chars.length) {
		pieces.push({ text: chars.slice(at).join(''), match: false, at });
	}
	return pieces;
}
