import {
    isTemporaryFile,
    arrayBufferToString,
    toArrayBuffer,
} from '@src/utils/fileUtils';

describe('File Utils', () => {
    describe('isTemporaryFile', () => {
        it('should identify temporary files', () => {
            expect(isTemporaryFile('/.texlyre-cache/file.aux')).toBe(true);
            expect(isTemporaryFile('/.texlyre-temp/build/output.pdf')).toBe(true);
        });

        it('should reject non-temporary files', () => {
            expect(isTemporaryFile('/main.tex')).toBe(false);
            expect(isTemporaryFile('/chapters/intro.tex')).toBe(false);
            expect(isTemporaryFile('/images/figure.png')).toBe(false);
        });

        it('keeps Git\'s own folder apart from a repository\'s .github and .gitignore', () => {
            expect(isTemporaryFile('/.git')).toBe(true);
            expect(isTemporaryFile('/.git/config')).toBe(true);
            expect(isTemporaryFile('/node_modules/x/index.js')).toBe(true);
            expect(isTemporaryFile('/.github/workflows/feuillet.yml')).toBe(false);
            expect(isTemporaryFile('/.gitignore')).toBe(false);
            expect(isTemporaryFile('/.gitattributes')).toBe(false);
            expect(isTemporaryFile('/node_modules_notes.txt')).toBe(false);
        });

        it('should handle edge cases', () => {
            expect(isTemporaryFile('')).toBe(false);
            expect(isTemporaryFile('/')).toBe(false);
            expect(isTemporaryFile('.texlyre-cache')).toBe(false);
        });
    });

    describe('arrayBufferToString', () => {
        it('should convert ArrayBuffer to string', () => {
            const text = 'Hello, World!';
            const buffer = new TextEncoder().encode(text).buffer;

            const result = arrayBufferToString(buffer);

            expect(result).toBe(text);
        });

        it('should handle UTF-8 characters', () => {
            const text = 'Hello 世界 🌍';
            const buffer = new TextEncoder().encode(text).buffer;

            const result = arrayBufferToString(buffer);

            expect(result).toBe(text);
        });

        it('should handle empty buffer', () => {
            const buffer = new ArrayBuffer(0);

            const result = arrayBufferToString(buffer);

            expect(result).toBe('');
        });
    });

    describe('toArrayBuffer', () => {
        it('should convert Uint8Array to ArrayBuffer', () => {
            const data = new Uint8Array([72, 101, 108, 108, 111]);

            const result = toArrayBuffer(data);

            expect(result).toBeInstanceOf(ArrayBuffer);
            expect(new Uint8Array(result)).toEqual(data);
        });

        it('should preserve data integrity', () => {
            const original = 'Test data 123';
            const uint8 = new TextEncoder().encode(original);

            const buffer = toArrayBuffer(uint8);
            const decoded = new TextDecoder().decode(buffer);

            expect(decoded).toBe(original);
        });
    });
});