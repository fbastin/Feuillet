// server/collab/totp.js
// Time-based one-time codes (RFC 6238: HMAC-SHA-1, 6 digits, 30 seconds), as
// authenticator apps make them (Google Authenticator, Aegis, FreeOTP,
// 1Password...), for two-factor authentication (accounts.js). The secret is
// 20 random bytes, given to the app in base32, by a QR code of its otpauth://
// address or typed.

const crypto = require('node:crypto');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PERIOD_S = 30;
const DIGITS = 6;
// A code of the step before or after is accepted too: clocks drift, and
// typing takes time.
const WINDOW = 1;

const base32Encode = (bytes) => {
	let bits = 0;
	let value = 0;
	let out = '';
	for (const byte of bytes) {
		value = (value << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			out += ALPHABET[(value >>> (bits - 5)) & 31];
			bits -= 5;
		}
	}
	if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
	return out;
};

const base32Decode = (text) => {
	const clean = String(text).toUpperCase().replace(/[\s=-]/g, '');
	let bits = 0;
	let value = 0;
	const out = [];
	for (const char of clean) {
		const index = ALPHABET.indexOf(char);
		if (index < 0) throw new Error('invalid base32');
		value = (value << 5) | index;
		bits += 5;
		if (bits >= 8) {
			out.push((value >>> (bits - 8)) & 255);
			bits -= 8;
		}
	}
	return Buffer.from(out);
};

/** A new secret, in base32. */
const newSecret = () => base32Encode(crypto.randomBytes(20));

/** The code of `step` (the 30-second period since 1970) for a secret. */
const codeAt = (secret, step) => {
	const counter = Buffer.alloc(8);
	counter.writeBigUInt64BE(BigInt(step));
	const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
	const offset = hmac[hmac.length - 1] & 15;
	const number = hmac.readUInt32BE(offset) & 0x7fffffff;
	return String(number % 10 ** DIGITS).padStart(DIGITS, '0');
};

const stepAt = (now = Date.now()) => Math.floor(now / 1000 / PERIOD_S);

/** Whether `code` has the shape of a one-time code: six digits, spaces aside. */
const isCode = (code) => /^\d{6}$/.test(String(code ?? '').replace(/\s/g, ''));

/**
 * The step `code` belongs to, within the window around now, if it is later
 * than `after` (a code is accepted once); otherwise null.
 */
const verify = (secret, code, { now = Date.now(), after = -1 } = {}) => {
	const given = String(code ?? '').replace(/\s/g, '');
	if (!isCode(given)) return null;
	const current = stepAt(now);
	for (let step = current - WINDOW; step <= current + WINDOW; step++) {
		if (step <= after) continue;
		const expected = codeAt(secret, step);
		if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given))) {
			return step;
		}
	}
	return null;
};

/** The otpauth:// address an authenticator app reads from the QR code. */
const otpauthUri = ({ secret, account, issuer }) => {
	// Spaces as %20: some apps show a + as it is.
	const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
	const params = Object.entries({
		secret,
		issuer,
		algorithm: 'SHA1',
		digits: DIGITS,
		period: PERIOD_S,
	})
		.map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
		.join('&');
	return `otpauth://totp/${label}?${params}`;
};

module.exports = {
	base32Encode,
	base32Decode,
	newSecret,
	codeAt,
	stepAt,
	isCode,
	verify,
	otpauthUri,
};
