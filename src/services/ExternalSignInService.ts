// src/services/ExternalSignInService.ts
// "Sign in with Google" and "Sign in with ORCID", as on Overleaf: the
// collaboration server runs the site's sign-in in a window it opens
// (server/collab/oidcSignIn.js) and hands this page a ticket for that
// account, which the account server takes to sign in to the account linked
// to it, to link it, or to create an account linked to it. The site tells
// Feuillet only who the account is, not its address nor its name.
import { t } from '@/i18n';
import { availabilityCache, openOAuthPopup } from './OAuthPopup';

export type SignInProvider = 'google' | 'orcid';

/** In the order the sign-in page offers them. */
export const SIGN_IN_PROVIDERS: readonly SignInProvider[] = ['google', 'orcid'];

/** As people know them; not translated. */
export const PROVIDER_NAMES: Record<SignInProvider, string> = {
	google: 'Google',
	orcid: 'ORCID',
};

/** A site's ticket, to sign in, link an account or create one. */
export interface ProviderTicket {
	provider: SignInProvider;
	ticket: string;
}

export interface ExternalSignIn {
	/** The ticket, once the user chose an account on the site. */
	ticket: Promise<string>;
	/** Stops waiting, and closes the window when it can. */
	cancel: () => void;
}

const TICKET = /^[A-Za-z0-9_-]{43}$/;

class ExternalSignInService {
	/** Whether the collaboration server signs in with this site. */
	readonly isAvailable: (baseUrl: string) => Promise<boolean>;

	constructor(readonly provider: SignInProvider) {
		this.isAvailable = availabilityCache(`/${provider}/config`);
	}

	signIn(baseUrl: string): ExternalSignIn {
		const provider = PROVIDER_NAMES[this.provider];
		const errorText = (error?: string): string => {
			if (error === 'denied') {
				return t('Signing in with {provider} was cancelled.', { provider });
			}
			if (error === 'expired') {
				return t('Signing in with {provider} took too long. Try again.', {
					provider,
				});
			}
			return t('{provider} did not complete the sign-in. Try again later.', {
				provider,
			});
		};
		const { result, cancel } = openOAuthPopup<string>({
			loginUrl: `${baseUrl}/${this.provider}/login`,
			channel: `feuillet-${this.provider}-oauth`,
			windowName: `feuillet-${this.provider}`,
			take: (message) =>
				typeof message.ticket === 'string' && TICKET.test(message.ticket)
					? message.ticket
					: undefined,
			errorText,
			blockedText: t(
				'Allow pop-ups for this site to sign in with {provider}.',
				{
					provider,
				},
			),
		});
		return { ticket: result, cancel };
	}
}

export const signInServices: Record<SignInProvider, ExternalSignInService> = {
	google: new ExternalSignInService('google'),
	orcid: new ExternalSignInService('orcid'),
};
