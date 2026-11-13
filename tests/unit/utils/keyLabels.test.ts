// Keys as written on each machine (src/utils/keyLabels.ts): Ctrl is Cmd on
// a Mac, Control the Control key everywhere.
import { keysLabel } from '@src/utils/keyLabels';

describe('key labels', () => {
	it('writes the keys as given elsewhere than on a Mac', () => {
		expect(keysLabel('Ctrl+Shift+M', false)).toBe('Ctrl+Shift+M');
		expect(keysLabel('Control+Shift+I', false)).toBe('Ctrl+Shift+I');
		expect(keysLabel('F8', false)).toBe('F8');
	});

	it('writes them with the Mac symbols, in the Mac order', () => {
		expect(keysLabel('Ctrl+Shift+M', true)).toBe('⇧⌘M');
		expect(keysLabel('Ctrl+Enter', true)).toBe('⌘↩');
		expect(keysLabel('Control+Shift+I', true)).toBe('⌃⇧I');
		expect(keysLabel('Shift+F9', true)).toBe('⇧F9');
	});
});
