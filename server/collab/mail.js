// server/collab/mail.js
// Feuillet's few emails, for recovering an account as on Overleaf:
// confirming the address it may be recovered with, and a link to choose a
// new password. They go through the SMTP server given by SMTP_URL (such as
// smtps://user:password@smtp.example.org or smtp://host.docker.internal:25),
// from MAIL_FROM (such as "Feuillet <noreply@example.org>"). Without both,
// Feuillet sends none and offers no recovery by email.
//
// Messages are plain text, in the language of the page that asked for them
// (French or English), and name nothing but the account and the link.

const MESSAGES = {
	fr: {
		confirm: ({ username, link }) => ({
			subject: 'Confirmez votre adresse de récupération Feuillet',
			text: [
				`Bonjour ${username},`,
				'',
				'Pour que cette adresse serve à récupérer votre compte Feuillet si vous oubliez votre mot de passe, ouvrez ce lien dans les 24 heures :',
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
	},
	en: {
		confirm: ({ username, link }) => ({
			subject: 'Confirm your Feuillet recovery address',
			text: [
				`Hello ${username},`,
				'',
				'For this address to recover your Feuillet account if you forget your password, open this link within 24 hours:',
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
	},
};

/**
 * A mailer, or null when no SMTP server is set. `transport` replaces the
 * SMTP one (tests).
 */
const createMailer = ({ url, from, log, transport = null }) => {
	if (!from || (!url && !transport)) return null;
	const transporter =
		transport ?? require('nodemailer').createTransport(url);

	const send = async (kind, { to, language, username, link }) => {
		const messages = MESSAGES[language === 'fr' ? 'fr' : 'en'];
		const { subject, text } = messages[kind]({ username, link });
		try {
			await transporter.sendMail({ from, to, subject, text });
			log(`${kind} email sent`);
		} catch (error) {
			// The server's address and the error, never the recipient's.
			log(`${kind} email not sent:`, error?.code ?? error?.message ?? error);
			throw error;
		}
	};

	return { send };
};

module.exports = { createMailer };
