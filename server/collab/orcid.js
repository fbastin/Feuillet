// server/collab/orcid.js
// "Sign in with ORCID", as on Overleaf (oidcSignIn.js): ORCID's OpenID
// Connect flow (https://orcid.org/.well-known/openid-configuration), which
// names the researcher by their ORCID iD. ORCID does not take PKCE; the
// state, the nonce and the client's secret guard the exchange.

const { createOidcSignIn, identityOf } = require('./oidcSignIn');

const createOrcid = ({
	// ORCID's addresses: https://sandbox.orcid.org's to try it, or tests'.
	authorizeUrl = 'https://orcid.org/oauth/authorize',
	tokenUrl = 'https://orcid.org/oauth/token',
	issuer = new URL(authorizeUrl).origin,
	...options
}) =>
	createOidcSignIn({
		...options,
		id: 'orcid',
		name: 'ORCID',
		authorizeUrl,
		tokenUrl,
		issuers: [issuer],
		// An ORCID iD: 0000-0002-1825-0097.
		subject: /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/,
		pkce: false,
	});

module.exports = {
	createOrcid,
	identityOf: (subject) => identityOf('orcid', subject),
};
