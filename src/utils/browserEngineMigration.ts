// src/utils/browserEngineMigration.ts
// The compiler in the browser, from SwiftLaTeX to BusyTeX, once (2026-11):
// SwiftLaTeX compiles with TeX Live 2020 and downloads its files from
// TeXlyre's package server (texlive.texlyre.org), which was down for hours
// on 2026-11-25, when it compiled nothing; BusyTeX compiles with TeX Live
// 2026, its files coming from Feuillet's own site. Settings keep every
// value, defaults included, so the engine that each account of this browser
// has kept moves once, to the same engine of BusyTeX; one may choose
// SwiftLaTeX again afterwards. An engine chosen for a project stays.

export const SWIFTLATEX_MOVED_KEY = 'feuillet-busytex-default';

const MOVES: Record<string, string> = {
	pdftex: 'busytex-pdftex',
	xetex: 'busytex-xetex',
};

const isSettingsKey = (key: string) =>
	key === 'texlyre-settings' ||
	(key.startsWith('texlyre-user-') && key.endsWith('-settings'));

/** Moves the kept engine settings off SwiftLaTeX; gives how many moved. */
export function moveEnginesToBusyTeX(storage: Storage): number {
	if (storage.getItem(SWIFTLATEX_MOVED_KEY)) return 0;
	const keys: string[] = [];
	for (let index = 0; index < storage.length; index++) {
		const key = storage.key(index);
		if (key && isSettingsKey(key)) keys.push(key);
	}
	let moved = 0;
	for (const key of keys) {
		try {
			const settings = JSON.parse(storage.getItem(key) ?? 'null');
			const engine = settings?.['latex-engine'];
			if (typeof engine !== 'string' || !MOVES[engine]) continue;
			storage.setItem(
				key,
				JSON.stringify({ ...settings, 'latex-engine': MOVES[engine] }),
			);
			moved++;
		} catch {
			// Unreadable settings are left as they are.
		}
	}
	storage.setItem(SWIFTLATEX_MOVED_KEY, '1');
	return moved;
}
