import {
	fileNameFromUrl,
	isWebAddress,
	urlFetchErrorMessage,
} from '@src/utils/fileImportUtils';

describe('files from a URL', () => {
	it('names the file after the last segment of the address', () => {
		expect(fileNameFromUrl('https://example.org/refs/library.bib')).toBe(
			'library.bib',
		);
		expect(fileNameFromUrl(' https://example.org/a/figure.png?raw=1#x ')).toBe(
			'figure.png',
		);
		expect(fileNameFromUrl('https://example.org/data/')).toBe('data');
		expect(fileNameFromUrl('https://example.org/R%C3%A9sum%C3%A9.pdf')).toBe(
			'Résumé.pdf',
		);
		expect(fileNameFromUrl('https://example.org/a%2Fb%3A.txt')).toBe(
			'a_b_.txt',
		);
		expect(fileNameFromUrl('https://example.org/%E0%A4%A.txt')).toBe(
			'%E0%A4%A.txt',
		);
		expect(fileNameFromUrl('https://example.org')).toBe('');
		expect(fileNameFromUrl('not a url')).toBe('');
	});

	it('accepts only web addresses', () => {
		expect(isWebAddress('https://example.org/a.bib')).toBe(true);
		expect(isWebAddress('http://example.org')).toBe(true);
		expect(isWebAddress('ftp://example.org/a')).toBe(false);
		expect(isWebAddress('file:///etc/hosts')).toBe(false);
		expect(isWebAddress('example.org/a.bib')).toBe(false);
	});

	it('explains why the server did not fetch a file', () => {
		expect(urlFetchErrorMessage('blocked_address')).toMatch(/private/);
		expect(urlFetchErrorMessage('upstream_status', 404)).toBe(
			'The site answered with error 404.',
		);
		expect(urlFetchErrorMessage('upstream_status')).toBe(
			'The site did not send the file.',
		);
		expect(urlFetchErrorMessage('something_new')).toBe(
			'The file could not be downloaded.',
		);
	});
});
