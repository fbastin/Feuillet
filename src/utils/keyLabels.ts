// src/utils/keyLabels.ts
// Keys as written on this machine: Ctrl+Shift+M is ⇧⌘M on a Mac, where
// Ctrl stands for Cmd; Control+ is the Control key everywhere (⌃ on a Mac).

export const isMac =
	typeof navigator !== 'undefined' &&
	/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const MAC_ORDER = ['⌃', '⌥', '⇧', '⌘'];
const MAC_SYMBOLS: Record<string, string> = {
	Control: '⌃',
	Alt: '⌥',
	Shift: '⇧',
	Ctrl: '⌘',
	Cmd: '⌘',
};

export function keysLabel(keys: string, mac = isMac): string {
	const parts = keys.split('+');
	const key = parts.pop() ?? '';
	if (!mac) {
		return [
			...parts.map((part) => (part === 'Control' ? 'Ctrl' : part)),
			key,
		].join('+');
	}
	const modifiers = parts
		.map((part) => MAC_SYMBOLS[part] ?? part)
		.sort((a, b) => MAC_ORDER.indexOf(a) - MAC_ORDER.indexOf(b));
	return `${modifiers.join('')}${key === 'Enter' ? '↩' : key}`;
}
