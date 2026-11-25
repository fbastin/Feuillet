/**
 * @jest-environment node
 */
// The collaboration server's image copies its modules one by one
// (server/collab/Dockerfile): each module that server.js needs, directly or
// through another, must be in that list, or the server stops at its start.
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.join(__dirname, '../../../server/collab');

const copied = () => {
	const dockerfile = fs.readFileSync(path.join(DIR, 'Dockerfile'), 'utf8');
	const files = new Set<string>();
	for (const match of dockerfile.replace(/\\\n/g, ' ').matchAll(/^COPY\s+(.+)$/gm)) {
		for (const word of match[1].split(/\s+/)) {
			if (word.endsWith('.js')) files.add(word);
		}
	}
	return files;
};

const needed = () => {
	const found = new Set<string>();
	const visit = (file: string) => {
		if (found.has(file)) return;
		found.add(file);
		const source = fs.readFileSync(path.join(DIR, file), 'utf8');
		for (const match of source.matchAll(/require\(\s*['"]\.\/([\w./-]+?)(?:\.js)?['"]\s*\)/g)) {
			visit(`${match[1]}.js`);
		}
	};
	visit('server.js');
	return found;
};

describe("the collaboration server's image", () => {
	it('copies every module that server.js needs', () => {
		const inImage = copied();
		const missing = [...needed()].filter((file) => !inImage.has(file));
		expect(missing).toEqual([]);
	});
});
