import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';

// PostCSS names its nodes with nanoid, an ES module Jest does not load.
jest.mock('nanoid/non-secure', () => ({ nanoid: () => 'id' }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const dropPicoGroupRules = require('../../../scripts/postcss/drop-pico-group-rules.cjs');

const ROOT = path.join(__dirname, '../../..');

const cssFiles = (dir: string): string[] =>
	fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) return cssFiles(full);
		return entry.name.endsWith('.css') ? [full] : [];
	});

// Splits at the given characters outside (), [] and strings.
const splitTop = (text: string, at: RegExp): string[] => {
	const parts: string[] = [];
	let depth = 0;
	let quote = '';
	let current = '';
	for (const char of text) {
		if (quote) {
			if (char === quote) quote = '';
		} else if (char === '"' || char === "'") quote = char;
		else if (char === '(' || char === '[') depth++;
		else if (char === ')' || char === ']') depth--;
		else if (depth === 0 && at.test(char)) {
			parts.push(current);
			current = '';
			continue;
		}
		current += char;
	}
	parts.push(current);
	return parts.map((part) => part.trim()).filter(Boolean);
};

// The element a selector styles: its last compound, without what :not()
// excludes, names a class, an id, an attribute or an element type.
const namesItsSubject = (selector: string): boolean => {
	const compound = splitTop(selector, /[\s>+~]/).at(-1) ?? '';
	const positive = compound.replace(/:not\((?:[^()]|\([^()]*\))*\)/g, '');
	return /[.#[]|^[a-zA-Z]|:is\(|:where\(/.test(positive);
};

describe('selectors with :has()', () => {
	// With :has() in a selector, Chrome restyles every element the rule could
	// style at each change anywhere in the page: a rule for « any element »
	// (the mobile theme's « all but the tabs ») made each key typed in a
	// long document restyle the whole page, whatever the layout.
	it('name the elements they style, in every style sheet of Feuillet', () => {
		const files = [
			...cssFiles(path.join(ROOT, 'src/styles')),
			...cssFiles(path.join(ROOT, 'extras')),
		];
		const vague: string[] = [];
		for (const file of files) {
			postcss.parse(fs.readFileSync(file, 'utf8')).walkRules((rule) => {
				if (!rule.selector.includes(':has(')) return;
				for (const selector of rule.selectors) {
					if (selector.includes(':has(') && !namesItsSubject(selector)) {
						vague.push(`${path.relative(ROOT, file)}: ${selector}`);
					}
				}
			});
		}
		expect(files.length).toBeGreaterThan(20);
		expect(vague).toEqual([]);
	});

	it('tell a vague subject from a named one', () => {
		expect(namesItsSubject('.a:has(.b) > .c > :not(.d[x="y"])')).toBe(false);
		expect(namesItsSubject('.a:has(.b) > .c > :is(.d, .e)')).toBe(true);
		expect(namesItsSubject('body:has(.x) .button')).toBe(true);
		expect(namesItsSubject('label:has(input:checked)')).toBe(true);
	});

	it("are left out of Pico's styles for groups, the rest kept", async () => {
		const file = path.join(ROOT, 'node_modules/@picocss/pico/css/pico.min.css');
		const css = fs.readFileSync(file, 'utf8');
		const before = postcss.parse(css);
		const result = await postcss([dropPicoGroupRules()]).process(css, { from: file });
		const groupHas = /\[role=["']?(?:group|search)["']?\]:has\(/;
		let left = 0;
		let rules = 0;
		result.root.walkRules((rule) => {
			rules++;
			if (groupHas.test(rule.selector)) left++;
		});
		let had = 0;
		let total = 0;
		before.walkRules((rule) => {
			total++;
			if (groupHas.test(rule.selector)) had++;
		});
		expect(had).toBeGreaterThan(3);
		expect(left).toBe(0);
		expect(rules).toBeGreaterThan(total - had - 1);
	});
});
