// server/collab/mail.js
// Feuillet's few emails, as Overleaf's: confirming the account's email
// address, a link to choose a new password, an invitation to a project, a
// link to make an account (where accounts need an invitation, accounts.js),
// a reply to one's comment or a mention in one (reviewNotices.js), a
// request for more access to one's project and its answer (shares.js), and a
// change to how one's account is signed in to or recovered (the password,
// two-factor authentication, recovery codes, its address, Google or ORCID,
// a Git token), so that a change its owner did not make does not go
// unseen.
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
// to one address. Review emails and access requests take at most a quarter,
// invitations and them three quarters together, and 5 to one address apart
// from the rest:
// they never stop an account's recovery. Security emails too take at most a
// quarter, and 5 to one address apart from the rest. They are counted in
// memory, from the server's start.

const crypto = require('node:crypto');

const DAY_MS = 24 * 60 * 60 * 1000;
const DAILY_LIMIT = 200;
const PER_RECIPIENT = 10;
const REVIEW_PER_RECIPIENT = 5;
const SECURITY_PER_RECIPIENT = 5;

// Some of a comment in an email: as written, line breaks kept, not too long.
const excerpt = (text, max = 600) => {
	const value = String(text ?? '')
		.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
	return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};
const quoted = (text) =>
	excerpt(text)
		.split('\n')
		.map((line) => `> ${line}`)
		.join('\n');

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
		signup: ({ link }) => ({
			subject: 'Créer votre compte Feuillet',
			text: [
				'Bonjour,',
				'',
				"Pour créer votre compte Feuillet avec cette adresse, ouvrez ce lien dans les 24 heures :",
				'',
				link,
				'',
				"Le lien sert une fois. Si vous n'avez rien demandé, ignorez ce message : aucun compte ne sera créé.",
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
		review: ({ username, inviter, project, why, passage, comment, written, link }) => ({
			subject:
				why === 'reply'
					? `${inviter} a répondu dans « ${project} »`
					: `${inviter} vous mentionne dans « ${project} »`,
			text: [
				`Bonjour ${username},`,
				'',
				why === 'reply'
					? `${inviter} a répondu à un commentaire auquel vous avez participé, dans le projet « ${project} » :`
					: why === 'mention-reply'
						? `${inviter} vous mentionne dans une réponse à un commentaire, dans le projet « ${project} » :`
						: `${inviter} vous mentionne dans un commentaire, dans le projet « ${project} » :`,
				'',
				...(passage ? [`Sur le passage : « ${oneLine(passage, 120)} »`, ''] : []),
				...(comment ? ['Commentaire :', quoted(comment), ''] : []),
				`${why === 'mention' ? 'Commentaire' : 'Réponse'} de ${inviter} :`,
				quoted(written),
				'',
				'Pour répondre, ouvrez le projet :',
				link,
				'',
				'Vous recevez ce message parce que votre compte Feuillet participe à ce projet. Pour ne plus en recevoir, décochez « Courriels de relecture » dans votre profil.',
			].join('\n'),
		}),
		security: ({ username, change, how, provider, label, link }) => {
			const what = {
				password: {
					subject: 'Le mot de passe de votre compte Feuillet a changé',
					line: `Le mot de passe de votre compte Feuillet « ${username} » vient d'être changé${how === 'recovery-code' ? ' avec un code de récupération' : how === 'email-link' ? ' par le lien envoyé à cette adresse' : ''}. Vos autres appareils devront se reconnecter.`,
				},
				'two-factor-on': {
					subject: 'Double authentification activée sur votre compte Feuillet',
					line: `La double authentification vient d'être activée sur votre compte Feuillet « ${username} » : se connecter demandera désormais, en plus du mot de passe, un code de votre application.`,
				},
				'two-factor-off': {
					subject: 'Double authentification désactivée sur votre compte Feuillet',
					line: `La double authentification vient d'être désactivée sur votre compte Feuillet « ${username} » : se connecter ne demande plus que le mot de passe.`,
				},
				'recovery-codes': {
					subject: 'Nouveaux codes de récupération pour votre compte Feuillet',
					line: `De nouveaux codes de récupération viennent d'être créés pour votre compte Feuillet « ${username} » ; les précédents ne servent plus.`,
				},
				'email-changed': {
					subject: "L'adresse de votre compte Feuillet a changé",
					line: `Une autre adresse courriel vient d'être confirmée pour votre compte Feuillet « ${username} » : celle-ci n'est plus la sienne et ne servira plus à le récupérer.`,
				},
				'email-removed': {
					subject: "L'adresse de votre compte Feuillet a été retirée",
					line: `Cette adresse vient d'être retirée de votre compte Feuillet « ${username} » : elle ne servira plus à le récupérer.`,
				},
				linked: {
					subject: `Connexion avec ${provider} ajoutée à votre compte Feuillet`,
					line: `Votre compte Feuillet « ${username} » peut maintenant s'ouvrir avec un compte ${provider}.`,
				},
				unlinked: {
					subject: `Connexion avec ${provider} retirée de votre compte Feuillet`,
					line: `Votre compte Feuillet « ${username} » ne s'ouvre plus avec un compte ${provider}.`,
				},
				'git-token': {
					subject: 'Nouveau jeton Git pour votre compte Feuillet',
					line: `Un jeton Git${label ? ` (« ${oneLine(label, 60)} »)` : ''} vient d'être créé pour votre compte Feuillet « ${username} » : avec lui, Git ouvre tous ses projets.`,
				},
			}[change];
			return {
				subject: what.subject,
				text: [
					`Bonjour ${username},`,
					'',
					what.line,
					'',
					"Si c'est vous, il n'y a rien à faire. Sinon, ouvrez Feuillet, changez votre mot de passe dans votre profil (votre nom, en haut à droite) et déconnectez les appareils que vous ne reconnaissez pas :",
					link,
				].join('\n'),
			};
		},
		'access-request': ({ username, inviter, project, role, link }) => ({
			subject:
				role === 'editor'
					? `${inviter} demande à modifier « ${project} »`
					: `${inviter} demande à relire « ${project} »`,
			text: [
				`Bonjour ${username},`,
				'',
				role === 'editor'
					? `${inviter} demande à pouvoir modifier votre projet « ${project} » sur Feuillet.`
					: `${inviter} demande à pouvoir relire votre projet « ${project} » sur Feuillet : le commenter et y suggérer des modifications.`,
				'',
				'Pour accepter ou refuser, ouvrez le projet, puis Partager :',
				link,
				'',
				`D'ici là, ${inviter} garde son accès actuel.`,
			].join('\n'),
		}),
		'access-decision': ({ username, inviter, project, role, why, link }) =>
			why === 'granted'
				? {
						subject:
							role === 'editor'
								? `Vous pouvez maintenant modifier « ${project} »`
								: `Vous pouvez maintenant relire « ${project} »`,
						text: [
							`Bonjour ${username},`,
							'',
							role === 'editor'
								? `${inviter} a accepté votre demande : vous pouvez maintenant modifier le projet « ${project} ».`
								: `${inviter} a accepté votre demande : vous pouvez maintenant relire le projet « ${project} », le commenter et y suggérer des modifications.`,
							'',
							'Ouvrez-le ici :',
							link,
						].join('\n'),
					}
				: {
						subject: `Votre demande d'accès à « ${project} »`,
						text: [
							`Bonjour ${username},`,
							'',
							`${inviter} n'a pas accepté votre demande de ${role === 'editor' ? 'modifier' : 'relire'} le projet « ${project} ». Vous gardez l'accès que vous aviez.`,
						].join('\n'),
					},
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
		signup: ({ link }) => ({
			subject: 'Create your Feuillet account',
			text: [
				'Hello,',
				'',
				'To create your Feuillet account with this address, open this link within 24 hours:',
				'',
				link,
				'',
				'The link works once. If you did not ask for it, ignore this message: no account will be created.',
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
		review: ({ username, inviter, project, why, passage, comment, written, link }) => ({
			subject:
				why === 'reply'
					? `${inviter} replied in "${project}"`
					: `${inviter} mentioned you in "${project}"`,
			text: [
				`Hello ${username},`,
				'',
				why === 'reply'
					? `${inviter} replied to a comment you took part in, in the project "${project}":`
					: why === 'mention-reply'
						? `${inviter} mentioned you in a reply to a comment, in the project "${project}":`
						: `${inviter} mentioned you in a comment, in the project "${project}":`,
				'',
				...(passage ? [`On the passage: "${oneLine(passage, 120)}"`, ''] : []),
				...(comment ? ['Comment:', quoted(comment), ''] : []),
				`${why === 'mention' ? 'Comment' : 'Reply'} by ${inviter}:`,
				quoted(written),
				'',
				'To reply, open the project:',
				link,
				'',
				'You get this message because your Feuillet account takes part in this project. To get no more, untick "Review emails" in your profile.',
			].join('\n'),
		}),
		security: ({ username, change, how, provider, label, link }) => {
			const what = {
				password: {
					subject: 'The password of your Feuillet account was changed',
					line: `The password of your Feuillet account "${username}" was just changed${how === 'recovery-code' ? ' with a recovery code' : how === 'email-link' ? ' through the link sent to this address' : ''}. Your other devices will have to sign in again.`,
				},
				'two-factor-on': {
					subject: 'Two-factor authentication turned on for your Feuillet account',
					line: `Two-factor authentication was just turned on for your Feuillet account "${username}": signing in will now take, besides the password, a code from your app.`,
				},
				'two-factor-off': {
					subject: 'Two-factor authentication turned off for your Feuillet account',
					line: `Two-factor authentication was just turned off for your Feuillet account "${username}": signing in now takes the password alone.`,
				},
				'recovery-codes': {
					subject: 'New recovery codes for your Feuillet account',
					line: `New recovery codes were just made for your Feuillet account "${username}"; the former ones no longer work.`,
				},
				'email-changed': {
					subject: 'The address of your Feuillet account was changed',
					line: `Another email address was just confirmed for your Feuillet account "${username}": this one is no longer its address and will no longer recover it.`,
				},
				'email-removed': {
					subject: 'The address of your Feuillet account was removed',
					line: `This address was just removed from your Feuillet account "${username}": it will no longer recover it.`,
				},
				linked: {
					subject: `Sign-in with ${provider} added to your Feuillet account`,
					line: `Your Feuillet account "${username}" can now be opened with a ${provider} account.`,
				},
				unlinked: {
					subject: `Sign-in with ${provider} removed from your Feuillet account`,
					line: `Your Feuillet account "${username}" no longer opens with a ${provider} account.`,
				},
				'git-token': {
					subject: 'New Git token for your Feuillet account',
					line: `A Git token${label ? ` ("${oneLine(label, 60)}")` : ''} was just made for your Feuillet account "${username}": with it, Git opens all its projects.`,
				},
			}[change];
			return {
				subject: what.subject,
				text: [
					`Hello ${username},`,
					'',
					what.line,
					'',
					'If this was you, there is nothing to do. Otherwise, open Feuillet, change your password in your profile (your name, top right) and sign out the devices you do not recognise:',
					link,
				].join('\n'),
			};
		},
		'access-request': ({ username, inviter, project, role, link }) => ({
			subject:
				role === 'editor'
					? `${inviter} asks to edit "${project}"`
					: `${inviter} asks to review "${project}"`,
			text: [
				`Hello ${username},`,
				'',
				role === 'editor'
					? `${inviter} asks to be able to edit your project "${project}" on Feuillet.`
					: `${inviter} asks to be able to review your project "${project}" on Feuillet: comment on it and suggest changes.`,
				'',
				'To grant or decline, open the project, then Share:',
				link,
				'',
				`Until then, ${inviter} keeps their current access.`,
			].join('\n'),
		}),
		'access-decision': ({ username, inviter, project, role, why, link }) =>
			why === 'granted'
				? {
						subject:
							role === 'editor'
								? `You can now edit "${project}"`
								: `You can now review "${project}"`,
						text: [
							`Hello ${username},`,
							'',
							role === 'editor'
								? `${inviter} granted your request: you can now edit the project "${project}".`
								: `${inviter} granted your request: you can now review the project "${project}", comment on it and suggest changes.`,
							'',
							'Open it here:',
							link,
						].join('\n'),
					}
				: {
						subject: `Your request for access to "${project}"`,
						text: [
							`Hello ${username},`,
							'',
							`${inviter} did not grant your request to ${role === 'editor' ? 'edit' : 'review'} the project "${project}". You keep the access you had.`,
						].join('\n'),
					},
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
	// When each email of the last 24 hours went, and of which kind, in all
	// and to each address (by a hash of it); review emails to an address
	// apart, so that they never stop the others.
	let sent = [];
	const sentTo = new Map();
	const reviewTo = new Map();
	const securityTo = new Map();
	const startedAt = now();

	const prune = (map, since) => {
		for (const [key, times] of map) {
			const recent = times.filter((at) => at > since);
			if (recent.length) map.set(key, recent);
			else map.delete(key);
		}
	};

	// Counts an email about to go, or refuses it.
	const take = (kind, to) => {
		const since = now() - DAY_MS;
		sent = sent.filter((entry) => entry.at > since);
		prune(sentTo, since);
		prune(reviewTo, since);
		prune(securityTo, since);
		const recipient = crypto
			.createHash('sha256')
			.update(String(to).toLowerCase())
			.digest('hex');
		// Telling one account of another's doing: review emails, access
		// requests and their answers.
		const notices = ['review', 'access-request', 'access-decision'];
		const notice = notices.includes(kind);
		const perAddress = notice
			? reviewTo
			: kind === 'security'
				? securityTo
				: sentTo;
		const toThem = perAddress.get(recipient) ?? [];
		const ofKinds = (...kinds) =>
			sent.filter((entry) => kinds.includes(entry.kind)).length;
		// Links to make an account count as invitations: asked for by anyone
		// at an address allowed, they never stop an account's recovery.
		const inviting = ['invite', 'signup', ...notices];
		const full =
			sent.length >= limit ||
			((kind === 'invite' || kind === 'signup') &&
				ofKinds(...inviting) >= Math.floor((limit * 3) / 4)) ||
			(notice &&
				(ofKinds(...notices) >= Math.floor(limit / 4) ||
					ofKinds(...inviting) >= Math.floor((limit * 3) / 4))) ||
			(kind === 'security' && ofKinds('security') >= Math.floor(limit / 4));
		const perLimit = notice
			? REVIEW_PER_RECIPIENT
				: kind === 'security'
					? SECURITY_PER_RECIPIENT
					: PER_RECIPIENT;
		if (full || toThem.length >= perLimit) {
			const which = toThem.length >= perLimit ? 'to one address' : 'a day';
			log(`${kind} email not sent: limit of emails ${which} reached`);
			throw new MailQuotaError();
		}
		sent.push({ at: now(), kind });
		perAddress.set(recipient, [...toThem, now()]);
	};

	const send = async (
		kind,
		{
			to,
			language,
			username,
			link,
			inviter,
			project,
			type,
			role,
			why,
			passage,
			comment,
			written,
			change,
			how,
			provider,
			label,
		},
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
			why,
			passage,
			comment,
			written,
			change,
			how,
			provider,
			label,
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
		sent = sent.filter((entry) => entry.at > since);
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
