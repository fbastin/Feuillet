// server/collab/mail.js
// Feuillet's few emails, as Overleaf's: confirming the account's email
// address, a link to choose a new password, and an invitation to a project.
// They go through the SMTP server given by SMTP_URL (such as
// smtps://user:password@smtp.example.org:465), from MAIL_FROM (such as
// "Feuillet <noreply@example.org>"). Without both, Feuillet sends none and
// offers no recovery by email.
//
// Messages are plain text, in the language of the page that asked for them
// (French or English), and name nothing but the accounts, the project and
// the link.
//
// Limits, since whoever makes accounts could otherwise have Feuillet mail
// anyone, and the mail provider would close the sending account: at most
// MAIL_DAILY_LIMIT emails (200 by default) in any 24 hours, invitations
// three quarters of them, so that recovering accounts still works; and 10
// to one address. They are counted in memory, from the server's start.

const crypto = require('node:crypto');

const DAY_MS = 24 * 60 * 60 * 1000;
const DAILY_LIMIT = 200;
const PER_RECIPIENT = 10;

// A project's name in an email: one line, not too long.
const oneLine = (text, max = 100) => {
	const line = String(text ?? '')
		.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

const ROLES = {
	fr: {
		editor: 'pourrez le modifier',
		reviewer: 'pourrez le réviser : le commenter et y suggérer des modifications',
		reader: 'pourrez le lire',
	},
	en: {
		editor: 'can edit it',
		reviewer: 'can review it: comment on it and suggest changes',
		reader: 'can read it',
	},
};

const MESSAGES = {
	fr: {
		confirm: ({ username, link }) => ({
			subject: 'Confirmez votre adresse courriel Feuillet',
			text: [
				`Bonjour ${username},`,
				'',
				'Pour que cette adresse soit celle de votre compte Feuillet, et serve à le récupérer si vous oubliez votre mot de passe, ouvrez ce lien dans les 24 heures :',
				'',
				link,
				'',
				"Si vous n'avez rien demandé, ignorez ce message : l'adresse ne sera pas enregistrée.",
			].join('\n'),
		}),
		reset: ({ username, link }) => ({
			subject: 'Choisir un nouveau mot de passe Feuillet',
			text: [
				`Bonjour ${username},`,
				'',
				"Quelqu'un a demandé un nouveau mot de passe pour votre compte Feuillet. Pour le choisir, ouvrez ce lien dans l'heure :",
				'',
				link,
				'',
				'Vos autres appareils devront ensuite se reconnecter.',
				"Si vous n'avez rien demandé, ignorez ce message : votre mot de passe ne change pas.",
			].join('\n'),
		}),
		invite: ({ inviter, project, kind, role, link }) => ({
			subject: `${inviter} vous invite à collaborer à « ${project} » sur Feuillet`,
			text: [
				'Bonjour,',
				'',
				`${inviter} vous invite à collaborer au projet ${kind} « ${project} » sur Feuillet. Vous ${ROLES.fr[role] ?? ROLES.fr.reader}.`,
				'',
				'Pour rejoindre le projet, ouvrez ce lien, puis connectez-vous ou créez un compte :',
				'',
				link,
				'',
				'Le lien sert une fois, pendant 30 jours.',
				'Si vous ne connaissez pas cette personne, ignorez ce message.',
			].join('\n'),
		}),
	},
	en: {
		confirm: ({ username, link }) => ({
			subject: 'Confirm your Feuillet email address',
			text: [
				`Hello ${username},`,
				'',
				'For this address to be your Feuillet account\'s, and recover it if you forget your password, open this link within 24 hours:',
				'',
				link,
				'',
				'If you did not ask for this, ignore this message: the address will not be kept.',
			].join('\n'),
		}),
		reset: ({ username, link }) => ({
			subject: 'Choose a new Feuillet password',
			text: [
				`Hello ${username},`,
				'',
				'Someone asked for a new password for your Feuillet account. To choose it, open this link within the hour:',
				'',
				link,
				'',
				'Your other devices will then have to sign in again.',
				'If you did not ask for this, ignore this message: your password does not change.',
			].join('\n'),
		}),
		invite: ({ inviter, project, kind, role, link }) => ({
			subject: `${inviter} invites you to work on "${project}" with Feuillet`,
			text: [
				'Hello,',
				'',
				`${inviter} invites you to work on the ${kind} project "${project}" with Feuillet. You ${ROLES.en[role] ?? ROLES.en.reader}.`,
				'',
				'To join the project, open this link, then sign in or create an account:',
				'',
				link,
				'',
				'The link works once, for 30 days.',
				'If you do not know this person, ignore this message.',
			].join('\n'),
		}),
	},
};

class MailQuotaError extends Error {
	constructor() {
		super('mail_quota');
		this.code = 'mail_quota';
	}
}

/**
 * A mailer, or null when no SMTP server is set. `transport` replaces the
 * SMTP one (tests); `dailyLimit` the 200 emails a day.
 */
const createMailer = ({
	url,
	from,
	log,
	transport = null,
	dailyLimit = DAILY_LIMIT,
	now = Date.now,
}) => {
	if (!from || (!url && !transport)) return null;
	const transporter =
		transport ?? require('nodemailer').createTransport(url);
	const limit =
		Number.isInteger(dailyLimit) && dailyLimit > 0 ? dailyLimit : DAILY_LIMIT;
	// When each email of the last 24 hours went, in all and to each address
	// (by a hash of it).
	let sent = [];
	const sentTo = new Map();
	const startedAt = now();

	// Counts an email about to go, or refuses it.
	const take = (kind, to) => {
		const since = now() - DAY_MS;
		sent = sent.filter((at) => at > since);
		for (const [key, times] of sentTo) {
			const recent = times.filter((at) => at > since);
			if (recent.length) sentTo.set(key, recent);
			else sentTo.delete(key);
		}
		const recipient = crypto
			.createHash('sha256')
			.update(String(to).toLowerCase())
			.digest('hex');
		const toThem = sentTo.get(recipient) ?? [];
		const share = kind === 'invite' ? Math.floor((limit * 3) / 4) : limit;
		if (sent.length >= share || toThem.length >= PER_RECIPIENT) {
			const which = toThem.length >= PER_RECIPIENT ? 'to one address' : 'a day';
			log(`${kind} email not sent: limit of emails ${which} reached`);
			throw new MailQuotaError();
		}
		sent.push(now());
		sentTo.set(recipient, [...toThem, now()]);
	};

	const send = async (
		kind,
		{ to, language, username, link, inviter, project, type, role },
	) => {
		const french = /^fr\b/i.test(String(language ?? ''));
		const messages = MESSAGES[french ? 'fr' : 'en'];
		const { subject, text } = messages[kind]({
			username,
			link,
			inviter,
			project: oneLine(project) || (french ? 'sans titre' : 'untitled'),
			kind: type === 'typst' ? 'Typst' : 'LaTeX',
			role,
		});
		take(kind, to);
		try {
			await transporter.sendMail({ from, to, subject, text });
			log(`${kind} email sent`);
		} catch (error) {
			// The server's address and the error, never the recipient's.
			log(`${kind} email not sent:`, error?.code ?? error?.message ?? error);
			throw error;
		}
	};

	// For the administration page (admin.js): the emails of the last 24
	// hours, counted since `since`, and the limits.
	const stats = () => {
		const since = now() - DAY_MS;
		sent = sent.filter((at) => at > since);
		return {
			sent: sent.length,
			limit,
			invitationLimit: Math.floor((limit * 3) / 4),
			since: startedAt,
		};
	};

	return { send, stats };
};

module.exports = { createMailer, MailQuotaError };
