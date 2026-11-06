// server/collab/releases.js
// The PDF of a GitHub release (« Publier une version sur GitHub »): the page
// creates the release itself with GitHub's API, but GitHub's upload server
// (uploads.github.com) does not answer pages of other sites (CORS), so the
// page sends the file here and this server hands it on, for a signed-in
// account. The GitHub token passes through, as when signing in with GitHub:
// it is neither kept nor written in the log.
//
//   POST /github/release-asset?repository=owner/repo&release=<id>&name=<file>
//        Authorization: Bearer <session>   X-GitHub-Token: <token>
//        body: the file                    -> GitHub's answer for the asset

const http = require('node:http');
const https = require('node:https');

const MAX_ASSET_BYTES = 100 * 1024 * 1024;
const MAX_ANSWER_BYTES = 64 * 1024;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_ACCOUNT = 30;
const MAX_CONCURRENT = 2;
const TIMEOUT_MS = 5 * 60 * 1000;
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;
const RELEASE = /^[0-9]{1,15}$/;
// Any token GitHub may give, nothing that could break the header.
const TOKEN = /^[\x21-\x7e]{8,512}$/;
const TYPES = {
	pdf: 'application/pdf',
	zip: 'application/zip',
};

class ReleaseError extends Error {
	constructor(status, code, extra = {}) {
		super(code);
		this.status = status;
		this.code = code;
		this.extra = extra;
	}
}

const reply = (res, status, body) => {
	res.writeHead(status, {
		'Content-Type': 'application/json',
		'Cache-Control': 'no-store',
	});
	res.end(JSON.stringify(body));
};

/** The asset's name, as GitHub keeps it, and its type; or null. */
const assetOf = (name) => {
	const value = String(name ?? '').trim();
	if (!value || value.length > 200 || /[\\/\u0000-\u001f]/.test(value)) {
		return null;
	}
	const type = TYPES[value.split('.').pop()?.toLowerCase() ?? ''];
	return type ? { name: value, type } : null;
};

const createReleaseAssets = ({
	accounts,
	uploadsUrl = 'https://uploads.github.com',
	log,
}) => {
	const base = new URL(uploadsUrl);
	const client = base.protocol === 'http:' ? http : https;
	const recent = new Map();
	let active = 0;

	setInterval(() => {
		const now = Date.now();
		for (const [account, times] of recent) {
			if (times.every((time) => now - time >= WINDOW_MS)) {
				recent.delete(account);
			}
		}
	}, WINDOW_MS).unref();

	const limit = (account) => {
		const now = Date.now();
		const times = (recent.get(account) ?? []).filter(
			(time) => now - time < WINDOW_MS,
		);
		if (times.length >= MAX_PER_ACCOUNT) {
			throw new ReleaseError(429, 'too_many_uploads');
		}
		times.push(now);
		recent.set(account, times);
	};

	const readBody = (req) =>
		new Promise((resolve, reject) => {
			const declared = Number(req.headers['content-length']);
			if (declared > MAX_ASSET_BYTES) {
				reject(new ReleaseError(413, 'too_large'));
				return;
			}
			const chunks = [];
			let size = 0;
			let failed = false;
			req.on('data', (chunk) => {
				if (failed) return;
				size += chunk.length;
				if (size > MAX_ASSET_BYTES) {
					failed = true;
					reject(new ReleaseError(413, 'too_large'));
					return;
				}
				chunks.push(chunk);
			});
			req.on('end', () => {
				if (!failed) resolve(Buffer.concat(chunks));
			});
			req.on('error', () => {
				if (!failed) reject(new ReleaseError(400, 'interrupted'));
			});
		});

	const upload = (path, token, type, body) =>
		new Promise((resolve, reject) => {
			const request = client.request(
				new URL(path, base),
				{
					method: 'POST',
					headers: {
						Authorization: `Bearer ${token}`,
						Accept: 'application/vnd.github+json',
						'X-GitHub-Api-Version': '2022-11-28',
						'Content-Type': type,
						'Content-Length': body.length,
						'User-Agent': 'Feuillet',
					},
					timeout: TIMEOUT_MS,
				},
				(response) => {
					const chunks = [];
					let size = 0;
					response.on('data', (chunk) => {
						size += chunk.length;
						if (size <= MAX_ANSWER_BYTES) chunks.push(chunk);
					});
					response.on('end', () => {
						let answer = {};
						try {
							answer = JSON.parse(Buffer.concat(chunks).toString('utf8'));
						} catch {}
						resolve({ status: response.statusCode ?? 502, answer });
					});
					response.on('error', reject);
				},
			);
			request.on('timeout', () => request.destroy(new Error('timeout')));
			request.on('error', reject);
			request.end(body);
		});

	const handles = (url) => url === '/github/release-asset';

	const handle = async (req, res) => {
		if (req.method !== 'POST') {
			req.resume();
			res.setHeader('Allow', 'POST, OPTIONS');
			reply(res, 405, { error: 'method_not_allowed' });
			return;
		}
		let counted = false;
		try {
			const account = await accounts.identify(req);
			const params = new URL(req.url, 'http://localhost').searchParams;
			const [owner, repo, ...rest] = String(
				params.get('repository') ?? '',
			).split('/');
			const release = params.get('release') ?? '';
			const asset = assetOf(params.get('name'));
			const token = String(req.headers['x-github-token'] ?? '');
			if (
				rest.length > 0 ||
				!OWNER.test(owner ?? '') ||
				!REPO.test(repo ?? '') ||
				repo === '.' ||
				repo === '..' ||
				!RELEASE.test(release) ||
				!asset
			) {
				throw new ReleaseError(400, 'bad_request');
			}
			if (!TOKEN.test(token)) throw new ReleaseError(400, 'no_token');
			limit(account);
			if (active >= MAX_CONCURRENT) throw new ReleaseError(503, 'busy');
			active++;
			counted = true;
			const body = await readBody(req);
			if (body.length === 0) throw new ReleaseError(400, 'empty');

			const path = `/repos/${owner}/${repo}/releases/${release}/assets?name=${encodeURIComponent(asset.name)}`;
			const { status, answer } = await upload(path, token, asset.type, body);
			if (status < 200 || status >= 300) {
				throw new ReleaseError(502, 'upstream_status', {
					status,
					message: typeof answer?.message === 'string' ? answer.message : '',
					code: answer?.errors?.[0]?.code,
				});
			}
			reply(res, 201, {
				name: answer.name,
				size: answer.size,
				url: answer.browser_download_url,
			});
		} catch (error) {
			req.resume();
			if (error instanceof ReleaseError || error?.status) {
				reply(res, error.status, { error: error.code, ...error.extra });
			} else {
				log('release asset upload failed', error?.message ?? error);
				reply(res, 502, { error: 'upload_failed' });
			}
		} finally {
			if (counted) active--;
		}
	};

	return { handles, handle };
};

module.exports = { createReleaseAssets, assetOf };
