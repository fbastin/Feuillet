// server/collab/google.js
// "Sign in with Google", as on Overleaf (oidcSignIn.js): Google's OpenID
// Connect flow, with PKCE; whoever has several Google accounts chooses one
// each time.

const { createOidcSignIn, identityOf } = require('./oidcSignIn');

const createGoogle = ({
	// Google's addresses, replaced in tests.
	authorizeUrl = 'https://accounts.google.com/o/oauth2/v2/auth',
	tokenUrl = 'https://oauth2.googleapis.com/token',
	...options
}) =>
	createOidcSignIn({
		...options,
		id: 'google',
		name: 'Google',
		authorizeUrl,
		tokenUrl,
		issuers: ['https://accounts.google.com', 'accounts.google.com'],
		// Google's subject identifiers: at most 255 ASCII characters.
		subject: /^[\x21-\x7e]{1,255}$/,
		prompt: 'select_account',
	});

module.exports = {
	createGoogle,
	identityOf: (subject) => identityOf('google', subject),
};
