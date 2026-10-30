// The template files in src/assets/templates, as the new-project form uses them.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { checkLatexCode } from '@src/utils/latexCodeCheck';
import {
	PROJECT_TEMPLATE_IDS,
	fillTemplate,
} from '@src/utils/projectStarterUtils';

const ASSETS = path.join(__dirname, '../../../src/assets');
const LANGUAGES = ['fr', 'en'];

const listFiles = (folder: string, prefix = ''): string[] =>
	readdirSync(folder).flatMap((name) => {
		const full = path.join(folder, name);
		return statSync(full).isDirectory()
			? listFiles(full, `${prefix}/${name}`)
			: [`${prefix}/${name}`];
	});

const templates = PROJECT_TEMPLATE_IDS.filter((id) => id !== 'blank').flatMap(
	(id) => LANGUAGES.map((language) => [id, language] as const),
);

describe('project templates', () => {
	it('come in every language, with a preview', () => {
		for (const id of PROJECT_TEMPLATE_IDS) {
			for (const language of LANGUAGES) {
				expect(
					existsSync(path.join(ASSETS, `template-previews/${id}-${language}.png`)),
				).toBe(true);
			}
		}
		const folders = readdirSync(path.join(ASSETS, 'templates')).sort();
		expect(folders).toEqual(
			PROJECT_TEMPLATE_IDS.filter((id) => id !== 'blank').sort(),
		);
	});

	it.each(templates)('%s (%s) has a main.tex and the files it uses', (id, language) => {
		const folder = path.join(ASSETS, 'templates', id, language);
		const files = listFiles(folder);
		expect(files).toContain('/main.tex');

		const main = readFileSync(path.join(folder, 'main.tex'), 'utf8');
		expect(main).toMatch(/^\\documentclass/);
		expect(main).toMatch(/\{\{(TITLE|AUTHOR|LAST_NAME)\}\}/);

		const used = files
			.filter((file) => file.endsWith('.tex'))
			.flatMap((file) =>
				[
					...readFileSync(path.join(folder, file), 'utf8').matchAll(
						/\\(include|input|includegraphics|addbibresource)(?:\[[^\]]*\])?\{([^}]+)\}/g,
					),
				].map(([, command, target]) =>
					command === 'include' || command === 'input'
						? `/${target.replace(/\.tex$/, '')}.tex`
						: `/${target}`,
				),
			);
		for (const target of used) expect(files).toContain(target);
	});

	it.each(templates)('%s (%s) passes the code check', (id, language) => {
		const folder = path.join(ASSETS, 'templates', id, language);
		for (const file of listFiles(folder).filter((name) => name.endsWith('.tex'))) {
			const text = fillTemplate(readFileSync(path.join(folder, file), 'utf8'), {
				title: 'Titre',
				author: 'Camille Tremblay',
			});
			expect([file, checkLatexCode(text)]).toEqual([file, []]);
		}
	});
});
