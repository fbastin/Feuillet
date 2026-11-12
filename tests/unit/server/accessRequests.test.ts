/**
 * @jest-environment node
 */
// Access requests (server/collab/shares.js), as Overleaf's "Request
// access": whoever reads a project asks its owner to review or edit it; the
// owner is told by email and by a count, grants or declines; the account
// is told the answer, and granted, lists the project by its new role's
// link. The real accounts, shares and mail modules, a stand-in for SMTP.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';

const { createAccounts } = require('../../../server/collab/accounts.js');
const { createShares } = require('../../../server/collab/shares.js');
const { createMailer } = require('../../../server/collab/mail.js');

interface Mail {
	to: string;
	subject: string;
	text: string;
}

const PASSWORD = 'correct horse battery';

describe('access requests', () => {
	let dir: string;
	let server: http.Server;
	let base: string;
	let mails: Mail[];

	beforeEach(async () => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feuillet-requests-'));
		mails = [];
		const mailer = createMailer({
			from: 'Feuillet <noreply@example.org>',
			transport: { sendMail: async (mail: Mail) => void mails.push(mail) },
			log: () => {},
		});
		const appUrl = 'https://feuillet.example.org';
		const accounts = createAccounts({
			dir: path.join(dir, 'accounts'),
			log: () => {},
			mailer,
			appUrl,
		});
		const shares = createShares({
			dir: path.join(dir, 'shares'),
			log: () => {},
			accounts,
			mailer,
			appUrl,
		});
		server = http.createServer((req, res) => {
			const url = new URL(req.url ?? '/', 'http://x').pathname;
			if (shares.handles(url)) return void shares.handle(req, res, url);
			return void accounts.handle(req, res, url);
		});
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	});

	afterEach(async () => {
		await new Promise((resolve) => server.close(resolve));
		fs.rmSync(dir, { recursive: true, force: true });
	});

	const call = async (url: string, body?: unknown, token?: string, method = 'POST') => {
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
	const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

	// An account with a confirmed address, its interface in this language.
	const account = async (username: string, language = 'fr') => {
		const { body } = await call('/account/register', { username, password: PASSWORD });
		const token = body.token as string;
		await call(
			'/account/preferences',
			{ entries: [{ key: 'setting:language', value: language, updatedAt: Date.now() }] },
			token,
		);
		const address = `${username}@example.org`;
		await call('/account/email', { password: PASSWORD, address, language }, token);
		await settle();
		const mail = mails.filter((m) => m.to === address).at(-1);
		const link = /#confirm-email:(\S+)/.exec(mail?.text ?? '')?.[1];
		expect((await call('/account/email/confirm', { token: link })).status).toBe(200);
		return token;
	};

	// A project ada owns, and its read-only link.
	const project = async (owner: string) => {
		const id = crypto.randomUUID();
		const claimed = await call('/share/edit', { project: id, claim: true }, owner);
		expect(claimed.body.owner).toBe('you');
		const { body } = await call('/share/view', { project: id });
		return { id, view: body.view as string };
	};

	const listed = async (token: string) =>
		((await call('/account/projects', undefined, token, 'GET')).body.projects as {
			docUrl: string;
			deleted?: boolean;
		}[])
			.filter((entry) => !entry.deleted)
			.map((entry) => entry.docUrl);

	it('asks the owner for edit access by a read-only link, and grants it', async () => {
		const ada = await account('ada');
		const bob = await account('bob', 'en');
		const { id, view } = await project(ada);
		// Bob lists the project by its read-only link, as when he opened it.
		await call(
			'/account/projects',
			{ projects: [{ id: view, docUrl: `yjs:${view}`, name: 'Thèse', updatedAt: Date.now() }] },
			bob,
		);
		const before = mails.length;
		const asked = await call('/share/request', { project: view, role: 'editor', name: 'Thèse' }, bob);
		expect(asked.body).toEqual({ requested: 'editor' });
		await settle();
		expect(mails.slice(before)).toEqual([
			expect.objectContaining({ to: 'ada@example.org', subject: 'bob demande à modifier « Thèse »' }),
		]);
		expect(mails.at(-1)?.text).toContain(`https://feuillet.example.org/#yjs:${id}`);
		// What each sees.
		expect((await call('/share/edit', { project: id }, ada)).body.requests).toBe(1);
		expect((await call('/share/edit', { project: view }, bob)).body.requested).toBe('editor');
		const members = await call('/share/members', { project: id }, ada);
		expect(members.body.requests).toEqual([
			expect.objectContaining({ username: 'bob', role: 'editor' }),
		]);

		const granted = await call('/share/members', { project: id, grant: 'bob', name: 'Thèse', type: 'latex' }, ada);
		expect(granted.body.members).toEqual([{ username: 'bob', role: 'editor' }]);
		expect(granted.body.requests).toEqual([]);
		await settle();
		expect(mails.at(-1)).toEqual(
			expect.objectContaining({ to: 'bob@example.org', subject: 'You can now edit "Thèse"' }),
		);
		expect(mails.at(-1)?.text).toContain(`https://feuillet.example.org/#yjs:${id}`);
		// Bob's list names it by the editing link, no longer the read-only one.
		expect(await listed(bob)).toEqual([`yjs:${id}`]);
		expect((await call('/share/edit', { project: view }, bob)).body).toEqual(
			expect.objectContaining({ role: 'editor', edit: id }),
		);
		expect((await call('/share/edit', { project: id }, ada)).body.requests).toBe(0);
	});

	it('declines, and the account keeps its access', async () => {
		const ada = await account('ada');
		const bob = await account('bob');
		const { id, view } = await project(ada);
		await call('/share/request', { project: view, role: 'reviewer', name: 'Thèse' }, bob);
		const declined = await call('/share/members', { project: id, decline: 'bob' }, ada);
		expect(declined.body.members).toEqual([]);
		expect(declined.body.requests).toEqual([]);
		await settle();
		expect(mails.at(-1)).toEqual(
			expect.objectContaining({ to: 'bob@example.org', subject: "Votre demande d'accès à « Thèse »" }),
		);
		expect((await call('/share/edit', { project: view }, bob)).body).toEqual(
			expect.objectContaining({ role: null }),
		);
		expect((await call('/share/edit', { project: view }, bob)).body.requested).toBeUndefined();
	});

	it('takes only requests for more than one has', async () => {
		const ada = await account('ada');
		const bob = await account('bob');
		const { id, view } = await project(ada);
		// The owner, an editor by the editing link: nothing more to ask.
		expect((await call('/share/request', { project: id, role: 'editor' }, bob)).body).toEqual({
			error: 'has_access',
		});
		expect((await call('/share/request', { project: view, role: 'reader' }, bob)).status).toBe(400);
		// A reviewer may ask to edit, not to review.
		await call('/share/members', { project: id, add: { username: 'bob', role: 'reviewer' } }, ada);
		const review = (await call('/share/edit', { project: id }, ada)).body;
		expect(review.owner).toBe('you');
		expect((await call('/share/request', { project: view, role: 'reviewer' }, bob)).status).toBe(400);
		expect((await call('/share/request', { project: view, role: 'editor' }, bob)).body).toEqual({
			requested: 'editor',
		});
		// A project without owner: no one to ask.
		const orphan = crypto.randomUUID();
		const orphanView = (await call('/share/view', { project: orphan })).body.view;
		expect((await call('/share/request', { project: orphanView, role: 'editor' }, bob)).body).toEqual({
			error: 'no_owner',
		});
		// Signed out: refused.
		expect((await call('/share/request', { project: view, role: 'editor' })).status).toBe(401);
	});

	it('tells the owner once a day of one account, and lets it withdraw', async () => {
		const ada = await account('ada');
		const bob = await account('bob');
		const { id, view } = await project(ada);
		const before = mails.length;
		await call('/share/request', { project: view, role: 'reviewer', name: 'Thèse' }, bob);
		await call('/share/request', { project: view, role: 'reviewer', name: 'Thèse' }, bob);
		await settle();
		expect(mails.length - before).toBe(1);
		// Asking for more is news.
		await call('/share/request', { project: view, role: 'editor', name: 'Thèse' }, bob);
		await settle();
		expect(mails.length - before).toBe(2);
		expect(mails.at(-1)?.subject).toBe('bob demande à modifier « Thèse »');
		expect((await call('/share/request', { project: view, cancel: true }, bob)).body).toEqual({
			requested: null,
		});
		expect((await call('/share/edit', { project: id }, ada)).body.requests).toBe(0);
		// Unknown to the owner now.
		expect((await call('/share/members', { project: id, grant: 'bob' }, ada)).status).toBe(404);
	});

	it('keeps deciding to the owner', async () => {
		const ada = await account('ada');
		const bob = await account('bob');
		const carol = await account('carol');
		const { id, view } = await project(ada);
		await call('/share/request', { project: view, role: 'editor' }, bob);
		await call('/share/members', { project: id, add: { username: 'carol', role: 'editor' } }, ada);
		expect((await call('/share/members', { project: id, grant: 'bob' }, carol)).body).toEqual({
			error: 'not_owner',
		});
		// Others do not see the requests.
		expect((await call('/share/members', { project: id }, carol)).body.requests).toBeUndefined();
		expect((await call('/share/edit', { project: id }, carol)).body.requests).toBeUndefined();
	});
});
