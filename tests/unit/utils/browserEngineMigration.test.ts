// The compiler in the browser moves from SwiftLaTeX to BusyTeX once
// (src/utils/browserEngineMigration.ts): every kept engine setting, the same
// engine of BusyTeX; a choice made afterwards stays.
import {
	SWIFTLATEX_MOVED_KEY,
	moveEnginesToBusyTeX,
} from '@src/utils/browserEngineMigration';

describe('the move of the browser compiler to BusyTeX', () => {
	beforeEach(() => localStorage.clear());

	it("moves each account's SwiftLaTeX engine to BusyTeX's, once", () => {
		localStorage.setItem('texlyre-settings', JSON.stringify({ 'latex-engine': 'pdftex', _version: '1.3.9' }));
		localStorage.setItem('texlyre-user-a-settings', JSON.stringify({ 'latex-engine': 'xetex', other: 1 }));
		localStorage.setItem('texlyre-user-b-settings', JSON.stringify({ 'latex-engine': 'busytex-luatex' }));
		localStorage.setItem('texlyre-user-c-properties', JSON.stringify({ 'latex-engine': 'pdftex' }));

		expect(moveEnginesToBusyTeX(localStorage)).toBe(2);
		expect(JSON.parse(localStorage.getItem('texlyre-settings') ?? '{}')).toEqual({
			'latex-engine': 'busytex-pdftex',
			_version: '1.3.9',
		});
		expect(JSON.parse(localStorage.getItem('texlyre-user-a-settings') ?? '{}')).toEqual({
			'latex-engine': 'busytex-xetex',
			other: 1,
		});
		expect(JSON.parse(localStorage.getItem('texlyre-user-b-settings') ?? '{}')['latex-engine']).toBe('busytex-luatex');
		// Properties (a project's choice) are left.
		expect(JSON.parse(localStorage.getItem('texlyre-user-c-properties') ?? '{}')['latex-engine']).toBe('pdftex');
		expect(localStorage.getItem(SWIFTLATEX_MOVED_KEY)).toBe('1');

		// SwiftLaTeX chosen again afterwards stays.
		localStorage.setItem('texlyre-user-a-settings', JSON.stringify({ 'latex-engine': 'pdftex' }));
		expect(moveEnginesToBusyTeX(localStorage)).toBe(0);
		expect(JSON.parse(localStorage.getItem('texlyre-user-a-settings') ?? '{}')['latex-engine']).toBe('pdftex');
	});
});
