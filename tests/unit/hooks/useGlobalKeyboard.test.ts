import { renderHook } from '@testing-library/react';

import { useGlobalKeyboard } from '@src/hooks/useGlobalKeyboard';

describe('useGlobalKeyboard', () => {
	it('compiles on Ctrl+Enter and Cmd+Enter unless the editor handled it', () => {
		const compile = jest.fn();
		document.addEventListener('trigger-compile', compile);
		const { unmount } = renderHook(() => useGlobalKeyboard());

		document.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }),
		);
		document.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', metaKey: true }),
		);
		const handled = new KeyboardEvent('keydown', {
			key: 'Enter',
			ctrlKey: true,
			cancelable: true,
		});
		handled.preventDefault();
		document.dispatchEvent(handled);
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

		expect(compile).toHaveBeenCalledTimes(2);
		unmount();
		document.removeEventListener('trigger-compile', compile);
	});
});
