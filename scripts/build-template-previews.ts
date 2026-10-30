// scripts/build-template-previews.ts
// Compiles each new-project template (src/assets/templates) with latexmk and
// saves the first page as src/assets/template-previews/<id>-<language>.png.
// Needs TeX Live, pdftoppm and pngquant: npx tsx scripts/build-template-previews.ts [id...]
import { execFileSync } from 'node:child_process';
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Build-time constants that src/branding.ts reads, through fileUtils.
Object.assign(globalThis, {
	__APP_NAME__: 'Feuillet',
	__APP_SOURCE_URL__: '',
	__APP_VERSION__: '',
	__BASE_PATH__: '',
});

const ROOT = path.resolve(import.meta.dirname, '..');
const TEMPLATES = path.join(ROOT, 'src/assets/templates');
const PREVIEWS = path.join(ROOT, 'src/assets/template-previews');

const SAMPLE = {
	fr: { title: 'Titre du projet', author: 'Camille Tremblay' },
	en: { title: 'Project title', author: 'Alex Morgan' },
} as const;

const listFiles = (folder: string, prefix = ''): string[] =>
	readdirSync(folder).flatMap((name) => {
		const full = path.join(folder, name);
		return statSync(full).isDirectory()
			? listFiles(full, `${prefix}/${name}`)
			: [`${prefix}/${name}`];
	});

const main = async () => {
	const { PROJECT_TEMPLATE_IDS, createStarterFile, createTemplateFiles } =
		await import('../src/utils/projectStarterUtils');
	const only = process.argv.slice(2);
	mkdirSync(PREVIEWS, { recursive: true });

	for (const id of PROJECT_TEMPLATE_IDS) {
		if (only.length > 0 && !only.includes(id)) continue;
		for (const language of ['fr', 'en'] as const) {
			const values = SAMPLE[language];
			const files =
				id === 'blank'
					? [createStarterFile('latex', values.title, values.author, language)]
					: createTemplateFiles(
							listFiles(path.join(TEMPLATES, id, language)).map((file) => ({
								path: file,
								content: file.endsWith('.tex')
									? readFileSync(
											path.join(TEMPLATES, id, language, file),
											'utf8',
										)
									: Uint8Array.from(
											readFileSync(path.join(TEMPLATES, id, language, file)),
										).buffer,
							})),
							values,
						);

			const work = mkdtempSync(path.join(tmpdir(), `template-${id}-`));
			for (const file of files) {
				if (file?.type !== 'file') continue;
				const target = path.join(work, file.path);
				mkdirSync(path.dirname(target), { recursive: true });
				writeFileSync(
					target,
					typeof file.content === 'string'
						? file.content
						: new Uint8Array(file.content as ArrayBuffer),
				);
			}

			execFileSync(
				'latexmk',
				[
					'-norc',
					'-pdf',
					'-interaction=nonstopmode',
					'-halt-on-error',
					'main.tex',
				],
				{ cwd: work, stdio: 'ignore' },
			);
			const page = path.join(work, 'page');
			execFileSync('pdftoppm', [
				'-png',
				'-singlefile',
				'-f',
				'1',
				'-l',
				'1',
				'-scale-to',
				'240',
				path.join(work, 'main.pdf'),
				page,
			]);
			const preview = path.join(PREVIEWS, `${id}-${language}.png`);
			execFileSync('pngquant', [
				'--quality=60-85',
				'--strip',
				'--force',
				'--output',
				preview,
				`${page}.png`,
			]);
			rmSync(work, { recursive: true, force: true });
			console.log(
				`${path.relative(ROOT, preview)} (${statSync(preview).size} bytes)`,
			);
		}
	}
};

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
