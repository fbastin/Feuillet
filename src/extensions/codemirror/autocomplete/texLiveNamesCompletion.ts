// src/extensions/codemirror/autocomplete/texLiveNamesCompletion.ts
// The braces of \usepackage, \documentclass, \bibliographystyle and Beamer's
// \usetheme… complete with every name TeX Live has, as on Overleaf, and with
// the project's own .sty, .cls and .bst files. Each name tells the TeX Live
// package it comes from, with its description, and the engine it needs when
// it is only for one. The list (scripts/generate-texlive-names.ts) loads the
// first time it is wanted.
import type {
	Completion,
	CompletionContext,
	CompletionResult,
	CompletionSource,
} from '@codemirror/autocomplete';
import { documentClasses, latexPackages } from 'codemirror-lang-latex';

import { t } from '@/i18n';
import { filePathCacheService } from '../../../services/FilePathCacheService';

type Kind = 'sty' | 'cls' | 'bst';
type Entry = [string, number] | [string, number, 'lua' | 'xe'];
type TexLiveNames = {
	release: number;
	bundles: Array<[string, string]>;
} & Record<Kind, Entry[]>;

/** What the braces before the cursor take, and how its names are spelt. */
type Argument = {
	kind: Kind;
	/** Beamer themes: the part after beamer…theme in the .sty name. */
	themePrefix?: string;
	/** Several names, separated by commas (\usepackage{a,b}). */
	list: boolean;
};

// The command, its [options], then the braces up to the cursor: across lines
// for a list, never past another brace or command.
const ARGUMENT =
	/\\(usepackage|RequirePackage|RequirePackageWithOptions|documentclass|LoadClass|LoadClassWithOptions|bibliographystyle|usetheme|usecolortheme|usefonttheme|useinnertheme|useoutertheme)\s*(?:\[[^\][{}\\]*\]\s*)?\{([^{}\\]*)$/;
const NAME = /[\w.@/+-]*$/;
const LOOK_BACK = 600;

const ARGUMENTS: Record<string, Argument> = {
	usepackage: { kind: 'sty', list: true },
	RequirePackage: { kind: 'sty', list: true },
	RequirePackageWithOptions: { kind: 'sty', list: false },
	documentclass: { kind: 'cls', list: false },
	LoadClass: { kind: 'cls', list: false },
	LoadClassWithOptions: { kind: 'cls', list: false },
	bibliographystyle: { kind: 'bst', list: false },
	usetheme: { kind: 'sty', themePrefix: 'beamertheme', list: true },
	usecolortheme: { kind: 'sty', themePrefix: 'beamercolortheme', list: true },
	usefonttheme: { kind: 'sty', themePrefix: 'beamerfonttheme', list: true },
	useinnertheme: { kind: 'sty', themePrefix: 'beamerinnertheme', list: true },
	useoutertheme: { kind: 'sty', themePrefix: 'beameroutertheme', list: true },
};

/** The commands whose braces hold such names (usepackage, usetheme…). */
export const TEX_LIVE_NAME_COMMANDS: ReadonlySet<string> = new Set(
	Object.keys(ARGUMENTS),
);

// The names people use most come first among equal matches.
const COMMON: Record<Kind, ReadonlySet<string>> = {
	sty: new Set(latexPackages),
	cls: new Set(documentClasses),
	bst: new Set([
		'plain',
		'unsrt',
		'alpha',
		'abbrv',
		'plainnat',
		'unsrtnat',
		'abbrvnat',
		'apalike',
		'ieeetr',
		'IEEEtran',
		'acm',
		'siam',
		'amsplain',
		'amsalpha',
		'apacite',
		'chicago',
		'elsarticle-num',
		'elsarticle-harv',
		'splncs04',
		'ACM-Reference-Format',
	]),
};

const ENGINES = { lua: 'LuaLaTeX', xe: 'XeLaTeX' } as const;
const EXTENSIONS: Record<Kind, string> = {
	sty: '.sty',
	cls: '.cls',
	bst: '.bst',
};

let loading: Promise<TexLiveNames> | null = null;
const loadNames = (): Promise<TexLiveNames> => {
	// A chunk of its own, served compressed as scripts are (the web server
	// leaves .json files as they are).
	loading ??= import('./__generated__/texliveNames.json').then(
		(module) => (module.default ?? module) as unknown as TexLiveNames,
	);
	// A failed load (offline before it was cached) is tried again next time.
	loading.catch(() => {
		loading = null;
	});
	return loading;
};

/** The argument the cursor is in, or null. */
export function texLiveNameArgument(
	before: string,
): (Argument & { typed: string }) | null {
	const match = ARGUMENT.exec(before);
	if (!match) return null;
	const argument = ARGUMENTS[match[1]];
	const inside = match[2];
	// Not in a comment that the current line has before the cursor.
	const line = before.slice(before.lastIndexOf('\n') + 1);
	if (/(^|[^\\])%/.test(line)) return null;
	if (!argument.list && /[,\n]/.test(inside.trimEnd())) return null;
	const typed = NAME.exec(inside)?.[0] ?? '';
	return { ...argument, typed };
}

const fromTexLive = new Map<string, Completion[]>();

function texLiveOptions(names: TexLiveNames, argument: Argument): Completion[] {
	const key = `${argument.kind}:${argument.themePrefix ?? ''}`;
	const cached = fromTexLive.get(key);
	if (cached) return cached;
	const prefix = argument.themePrefix;
	const options: Completion[] = [];
	for (const [file, bundleIndex, engine] of names[argument.kind]) {
		if (prefix && !file.startsWith(prefix)) continue;
		const label = prefix ? file.slice(prefix.length) : file;
		if (!label) continue;
		const [bundle, description] = names.bundles[bundleIndex];
		const eponymous = bundle === file.toLowerCase() || bundle === file;
		const detail = [eponymous ? '' : bundle, engine ? ENGINES[engine] : '']
			.filter(Boolean)
			.join(' · ');
		options.push({
			label,
			type: 'constant',
			detail: detail || undefined,
			info: description || undefined,
			boost: COMMON[argument.kind].has(label) ? 2 : eponymous ? 1 : 0,
		});
	}
	fromTexLive.set(key, options);
	return options;
}

/** The project's own files of that kind, as LaTeX looks them up. */
async function projectOptions(argument: Argument): Promise<Completion[]> {
	const extension = EXTENSIONS[argument.kind];
	const options: Completion[] = [];
	const files = await filePathCacheService.getCachedFiles();
	for (const file of filePathCacheService.flattenFiles(files)) {
		if (file.type !== 'file' || file.isDeleted) continue;
		if (!file.name.toLowerCase().endsWith(extension)) continue;
		let name = filePathCacheService
			.toCompileRelativePath(file.path)
			.slice(0, -extension.length);
		if (argument.themePrefix) {
			const base = name.split('/').pop() ?? name;
			if (!base.startsWith(argument.themePrefix)) continue;
			name = base.slice(argument.themePrefix.length);
		}
		if (!name) continue;
		options.push({
			label: name,
			type: 'constant',
			detail: t('in this project'),
			boost: 3,
		});
	}
	return options;
}

async function completeTexLiveNames(
	context: CompletionContext,
	argument: Argument & { typed: string },
): Promise<CompletionResult | null> {
	let names: TexLiveNames | null = null;
	try {
		names = await loadNames();
	} catch {
		// Offline before the list was cached: the project's files still are.
	}
	if (context.aborted) return null;
	const own = await projectOptions(argument).catch((): Completion[] => []);
	const seen = new Set(own.map((option) => option.label));
	const options = own.concat(
		names
			? texLiveOptions(names, argument).filter(
					(option) => !seen.has(option.label),
				)
			: [],
	);
	if (options.length === 0) return null;
	return {
		from: context.pos - argument.typed.length,
		options,
		validFor: /^[\w.@/+-]*$/,
	};
}

/**
 * The LaTeX completion, with these arguments answered from TeX Live
 * instead of the short list it has for \usepackage and \documentclass.
 */
export function withTexLiveNames(
	latexSource: CompletionSource,
): CompletionSource {
	return (context: CompletionContext) => {
		const before = context.state.sliceDoc(
			Math.max(0, context.pos - LOOK_BACK),
			context.pos,
		);
		if (!ARGUMENT.test(before)) return latexSource(context);
		// In these braces, its short list is not offered either: in a
		// comment, or after a comma where only one name goes.
		const argument = texLiveNameArgument(before);
		return argument ? completeTexLiveNames(context, argument) : null;
	};
}
