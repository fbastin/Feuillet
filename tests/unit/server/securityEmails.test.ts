/**
 * @jest-environment node
 */
// Security emails (server/collab/accounts.js, mail.js), as Overleaf's: a
// change to how an account is signed in to or recovered is told at its
// address, in its language, once the change is kept; an address replaced
// or removed hears of it; these emails have their own share, so that they
// never stop an account's recovery.
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';

const { createAccounts } = require('../../../server/collab/accounts.js');
const { createMailer } = require('../../../server/collab/mail.js');
const totp = require('../../../server/collab/totp.js');

interface Mail {
	to: string;
	subject: string;
	text: string;
}

const PASSWORD = 'correct horse battery';

describe('security emails', () => {
	let dir: string;
	let server: http.Server;
	let base: string;
	let mails: Mail[];
	let clock: number;

	beforeEach(async () => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feuillet-security-'));
		mails = [];
		clock = Date.now();
		const mailer = createMailer({
			from: 'Feuillet <noreply@example.org>',
			transport: { sendMail: async (mail: Mail) => void mails.push(mail) },
			log: () => {},
			now: () => clock,
		});
		const google = {
			enabled: true,
			identityFor: (ticket: string) => (ticket.startsWith('g:') ? ticket : null),
		};
		const accounts = createAccounts({
			dir,
			log: () => {},
			mailer,
			appUrl: 'https://feuillet.example.org',
			google,
		});
		server = http.createServer((req, res) =>
			accounts.handle(req, res, new URL(req.url ?? '/', 'http://x').pathname),
		);
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	});

	afterEach(async () => {
		await new Promise((resolve) => server.close(resolve));
		fs.rmSync(dir, { recursive: true, force: true });
	});

	const call = async (method: string, url: string, body?: unknown, token?: string) => {
		const response = await fetch(`${base}${url}`, {
			method,
			headers: {
				'Content-Type': 'application/json',
				...(token ? { Authorization: `Bearer ${token}` } : {}),
			},
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		const text = await response.text();
		return { status: response.status, body: text ? JSON.parse(text) : undefined };
	};
	// Emails go once the change is kept, without being waited for.
	const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
	const lastTo = (address: string) => mails.filter((mail) => mail.to === address).at(-1);
	const linkToken = (mail: Mail | undefined, kind: string) =>
		new RegExp(`#${kind}:([^\\s]+)`).exec(mail?.text ?? '')?.[1] ?? '';

	// An account with a confirmed address, its interface in French.
	const account = async (address = 'owner@example.org') => {
		const { body } = await call('POST', '/account/register', {
			username: 'ada',
			password: PASSWORD,
		});
		const token = body.token as string;
		await call(
			'POST',
			'/account/preferences',
			{ entries: [{ key: 'setting:language', value: 'fr', updatedAt: Date.now() }] },
			token,
		);
		await call('POST', '/account/email', { password: PASSWORD, address, language: 'fr' }, token);
		await settle();
		const confirm = await call('POST', '/account/email/confirm', {
			token: linkToken(lastTo(address), 'confirm-email'),
		});
		expect(confirm.status).toBe(200);
		await settle();
		return token;
	};

	it('tells of a new password, in the account language, with where to act', async () => {
		const token = await account();
		const before = mails.length;
		const changed = await call(
			'POST',
			'/account/password',
			{ password: PASSWORD, newPassword: 'another horse battery' },
			token,
		);
		expect(changed.status).toBe(204);
		await settle();
		expect(mails).toHaveLength(before + 1);
		const mail = mails.at(-1) as Mail;
		expect(mail.to).toBe('owner@example.org');
		expect(mail.subject).toBe('Le mot de passe de votre compte Feuillet a changé');
		expect(mail.text).toContain('« ada » vient d\'être changé.');
		expect(mail.text).toContain('https://feuillet.example.org/');
		// A wrong password changes nothing, and tells nothing.
		await call('POST', '/account/password', { password: 'nope', newPassword: 'x'.repeat(12) }, token);
		await settle();
		expect(mails).toHaveLength(before + 1);
	});

	it('tells of two-factor authentication on and off, new recovery codes and a Git token', async () => {
		const token = await account();
		const before = mails.length;
		const { body: begun } = await call('POST', '/account/two-factor', { password: PASSWORD }, token);
		const { body: on } = await call(
			'POST',
			'/account/two-factor',
			{ code: totp.codeAt(begun.secret, totp.stepAt()) },
			token,
		);
		expect(on.enabled).toBe(true);
		await call('POST', '/account/two-factor', { remove: true, password: PASSWORD, code: on.codes[0] }, token);
		await call('POST', '/account/recovery', { password: PASSWORD }, token);
		await call('POST', '/account/git-tokens', { password: PASSWORD, label: 'portable' }, token);
		await settle();
		expect(mails.slice(before).map((mail) => mail.subject)).toEqual([
			'Double authentification activée sur votre compte Feuillet',
			'Double authentification désactivée sur votre compte Feuillet',
			'Nouveaux codes de récupération pour votre compte Feuillet',
			'Nouveau jeton Git pour votre compte Feuillet',
		]);
		expect(mails.at(-1)?.text).toContain('Un jeton Git (« portable »)');
	});

	it('tells of Google sign-in added and removed', async () => {
		const token = await account();
		const before = mails.length;
		await call('POST', '/account/google', { password: PASSWORD, ticket: 'g:42' }, token);
		// The same Google account again: nothing new, nothing told.
		await call('POST', '/account/google', { password: PASSWORD, ticket: 'g:42' }, token);
		await call('POST', '/account/google', { password: PASSWORD, remove: true }, token);
		await settle();
		expect(mails.slice(before).map((mail) => mail.subject)).toEqual([
			'Connexion avec Google ajoutée à votre compte Feuillet',
			'Connexion avec Google retirée de votre compte Feuillet',
		]);
	});

	it('tells the former address when another one is confirmed, and a removed one', async () => {
		const token = await account();
		await call('POST', '/account/email', { password: PASSWORD, address: 'new@example.org', language: 'fr' }, token);
		await settle();
		const before = mails.length;
		await call('POST', '/account/email/confirm', { token: linkToken(lastTo('new@example.org'), 'confirm-email') });
		await settle();
		expect(mails.slice(before)).toEqual([
			expect.objectContaining({
				to: 'owner@example.org',
				subject: "L'adresse de votre compte Feuillet a changé",
			}),
		]);
		await call('POST', '/account/email', { password: PASSWORD, remove: true }, token);
		await settle();
		expect(mails.at(-1)).toEqual(
			expect.objectContaining({
				to: 'new@example.org',
				subject: "L'adresse de votre compte Feuillet a été retirée",
			}),
		);
		// Without an address, nothing to tell.
		const count = mails.length;
		await call('POST', '/account/password', { password: PASSWORD, newPassword: 'another horse battery' }, token);
		await settle();
		expect(mails).toHaveLength(count);
	});

	it('tells of a password reset by the emailed link or with a recovery code', async () => {
		const token = await account();
		const { body: recovery } = await call('POST', '/account/recovery', { password: PASSWORD }, token);
		await call('POST', '/account/forgot', { login: 'ada', language: 'fr' });
		await settle();
		const reset = await call('POST', '/account/reset', {
			token: linkToken(lastTo('owner@example.org'), 'reset-password'),
			newPassword: 'another horse battery',
		});
		expect(reset.status).toBe(200);
		await settle();
		expect(mails.at(-1)?.text).toContain("vient d'être changé par le lien envoyé à cette adresse");
		await call('POST', '/account/recover', {
			username: 'ada',
			code: recovery.codes[0],
			newPassword: 'a third horse battery',
		});
		await settle();
		expect(mails.at(-1)?.text).toContain("vient d'être changé avec un code de récupération");
	});

	it('sends at most 5 to an address a day, never in the way of recovery', async () => {
		const token = await account();
		const before = mails.length;
		for (let i = 0; i < 7; i++) {
			const changed = await call('POST', '/account/git-tokens', { password: PASSWORD, label: `t${i}` }, token);
			// The change is made even when the email cannot go.
			expect(changed.status).toBe(200);
		}
		await settle();
		expect(mails.slice(before)).toHaveLength(5);
		await call('POST', '/account/forgot', { login: 'ada', language: 'fr' });
		await settle();
		expect(mails.at(-1)?.subject).toBe('Choisir un nouveau mot de passe Feuillet');
		// The next day, again.
		clock += 24 * 60 * 60 * 1000 + 1;
		await call('POST', '/account/git-tokens', { password: PASSWORD, label: 'demain' }, token);
		await settle();
		expect(mails.at(-1)?.text).toContain('« demain »');
	});

	it('tells in English when the interface is', async () => {
		const { body } = await call('POST', '/account/register', { username: 'bob', password: PASSWORD });
		await call('POST', '/account/email', { password: PASSWORD, address: 'bob@example.org', language: 'en' }, body.token);
		await settle();
		await call('POST', '/account/email/confirm', { token: linkToken(lastTo('bob@example.org'), 'confirm-email') });
		await call('POST', '/account/recovery', { password: PASSWORD }, body.token);
		await settle();
		expect(mails.at(-1)).toEqual(
			expect.objectContaining({
				to: 'bob@example.org',
				subject: 'New recovery codes for your Feuillet account',
			}),
		);
		expect(mails.at(-1)?.text).toContain('If this was you, there is nothing to do.');
	});
});
