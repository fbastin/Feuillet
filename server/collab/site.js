// server/collab/site.js
// What the privacy page says of this server in particular, which differs
// from one Feuillet to another: whom to ask, the service that sends its
// emails, how long the web server keeps its logs and the backups what was
// erased, and which sign-ins and checks it offers. Each server says it,
// from its settings, rather than its operator editing the page's code.
//
//   GET /site -> {contact, mail, webLogDays, backupDays, signIn: {google,
//                orcid}, grammar}
//
// `mail` is null when the server sends no email, else {provider, privacy}:
// the service's name and its privacy policy, as MAIL_PROVIDER and
// MAIL_PROVIDER_PRIVACY_URL say, or else as SMTP_URL's server tells (Gmail
// for smtp.gmail.com; its name, without a policy, for another). `backupDays`
// is BACKUP_KEEP of deploy/backup.sh, nightly backups, as the last one
// says (0: all kept; null: none made yet).
//
// Environment (read by server.js):
//   PRIVACY_CONTACT     whom to ask about privacy: an email address or a web
//                       page; unset, the page points to the code's issues
//   MAIL_PROVIDER, MAIL_PROVIDER_PRIVACY_URL
//                       the service that sends the emails, and its privacy
//                       policy, when SMTP_URL does not tell it
//   WEB_LOG_DAYS        how long the web server keeps its logs (default 14,
//                       Debian's for Apache and nginx)

const fs = require('node:fs');
const path = require('node:path');

// Services an SMTP server's name tells, and their policies.
const KNOWN_PROVIDERS = [
	{
		host: /(^|\.)(gmail|googlemail|google)\.com$/,
		provider: 'Gmail',
		privacy: 'https://policies.google.com/privacy',
	},
	{
		host: /(^|\.)(office365|outlook)\.com$/,
		provider: 'Microsoft Outlook',
		privacy: 'https://privacy.microsoft.com/privacystatement',
	},
	{
		host: /(^|\.)fastmail\.com$/,
		provider: 'Fastmail',
		privacy: 'https://www.fastmail.com/about/privacy/',
	},
];

const httpsUrl = (value) => {
	try {
		const url = new URL(String(value ?? '').trim());
		return url.protocol === 'https:' ? url.toString() : null;
	} catch {
		return null;
	}
};

/** The service that sends the emails, or null when none is set. */
const mailProviderOf = ({ smtpUrl, from, provider, privacy }) => {
	if (!smtpUrl || !from) return null;
	let host = '';
	try {
		host = new URL(smtpUrl).hostname.toLowerCase();
	} catch {}
	const known = KNOWN_PROVIDERS.find((entry) => entry.host.test(host));
	const name = String(provider ?? '').trim().slice(0, 100);
	if (name) return { provider: name, privacy: httpsUrl(privacy) };
	if (known) return { provider: known.provider, privacy: known.privacy };
	return { provider: host || null, privacy: httpsUrl(privacy) };
};

/** An email address or an https page, or null. */
const contactOf = (value) => {
	const text = String(value ?? '').trim();
	if (/^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/.test(text) && text.length <= 254) {
		return text;
	}
	return httpsUrl(text);
};

const createSite = ({
	env = process.env,
	google = null,
	orcid = null,
	grammar = false,
	backupStatusDir = null,
}) => {
	const fixed = {
		contact: contactOf(env.PRIVACY_CONTACT),
		mail: mailProviderOf({
			smtpUrl: env.SMTP_URL,
			from: env.MAIL_FROM,
			provider: env.MAIL_PROVIDER,
			privacy: env.MAIL_PROVIDER_PRIVACY_URL,
		}),
		webLogDays: (() => {
			const days = Number.parseInt(env.WEB_LOG_DAYS ?? '', 10);
			return Number.isInteger(days) && days >= 0 ? days : 14;
		})(),
		signIn: { google: Boolean(google?.enabled), orcid: Boolean(orcid?.enabled) },
		grammar: Boolean(grammar),
	};

	// The last backup says how many are kept, BACKUP_KEEP.
	const backupDays = () => {
		if (!backupStatusDir) return null;
		try {
			const made = JSON.parse(
				fs.readFileSync(path.join(backupStatusDir, 'backup.json'), 'utf8'),
			);
			const keep = Number(made?.keep);
			return Number.isInteger(keep) && keep >= 0 ? keep : null;
		} catch {
			return null;
		}
	};

	const handles = (url) => url === '/site';

	const handle = (req, res) => {
		req.resume();
		if (req.method !== 'GET' && req.method !== 'HEAD') {
			res.writeHead(405, { Allow: 'GET', 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: 'method_not_allowed' }));
			return;
		}
		res.writeHead(200, {
			'Content-Type': 'application/json',
			'Cache-Control': 'no-cache',
		});
		res.end(JSON.stringify({ ...fixed, backupDays: backupDays() }));
	};

	return { handles, handle, info: () => ({ ...fixed, backupDays: backupDays() }) };
};

module.exports = { createSite, mailProviderOf, contactOf };
