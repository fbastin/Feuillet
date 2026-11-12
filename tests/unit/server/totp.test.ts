/**
 * @jest-environment node
 */
// The codes of two-factor authentication (server/collab/totp.js), against
// RFC 6238's test vectors (SHA-1; the last six of their eight digits).
const totp = require('../../../server/collab/totp.js');

describe('totp', () => {
	const secret = totp.base32Encode(Buffer.from('12345678901234567890'));

	it('encodes the RFC secret as authenticator apps read it', () => {
		expect(secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
		expect(totp.base32Decode(secret).toString()).toBe('12345678901234567890');
	});

	it.each([
		[59, '287082'],
		[1111111109, '081804'],
		[1111111111, '050471'],
		[1234567890, '005924'],
		[2000000000, '279037'],
		[20000000000, '353130'],
	])('gives the code of %i seconds', (time, code) => {
		expect(totp.codeAt(secret, Math.floor(time / 30))).toBe(code);
	});

	it('accepts the step before and after, each code once', () => {
		const now = 1_800_000_000_000;
		const step = totp.stepAt(now);
		expect(totp.verify(secret, totp.codeAt(secret, step), { now })).toBe(step);
		expect(totp.verify(secret, totp.codeAt(secret, step - 1), { now })).toBe(step - 1);
		expect(totp.verify(secret, totp.codeAt(secret, step + 1), { now })).toBe(step + 1);
		expect(totp.verify(secret, totp.codeAt(secret, step - 2), { now })).toBeNull();
		expect(totp.verify(secret, totp.codeAt(secret, step), { now, after: step })).toBeNull();
		expect(totp.verify(secret, 'abcdef', { now })).toBeNull();
	});

	it('makes the otpauth address with spaces as %20', () => {
		expect(
			totp.otpauthUri({ secret: 'ABC', account: 'alice', issuer: 'Feuillet (x.org)' }),
		).toBe(
			'otpauth://totp/Feuillet%20(x.org):alice?secret=ABC&issuer=Feuillet%20(x.org)&algorithm=SHA1&digits=6&period=30',
		);
	});
});
