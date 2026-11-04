// src/services/GoogleSignInService.ts
// "Sign in with Google", as on Overleaf: the collaboration server runs
// Google's sign-in in a window it opens (server/collab/google.js) and hands
// this page a ticket for the Google account, which the account server takes
// to sign in to the account linked to it, to link it, or to create an
// account linked to it. Google tells Feuillet only who the account is, not
// its address nor its name.
import { t } from '@/i18n';
import { availabilityCache, openOAuthPopup } from './OAuthPopup';

export interface GoogleSignIn {
	/** The ticket, once the user chose a Google account. */
	ticket: Promise<string>;
	/** Stops waiting, and closes the window when it can. */
	cancel: () => void;
}

const TICKET = /^[A-Za-z0-9_-]{43}$/;

const errorText = (error?: string): string => {
	if (error === 'denied') return t('Signing in with Google was cancelled.');
	if (error === 'expired') {
		return t('Signing in with Google took too long. Try again.');
	}
	return t('Google did not complete the sign-in. Try again later.');
};

class GoogleSignInService {
	/** Whether the collaboration server signs in with Google. */
	isAvailable = availabilityCache('/google/config');

	signIn(baseUrl: string): GoogleSignIn {
		const { result, cancel } = openOAuthPopup<string>({
			loginUrl: `${baseUrl}/google/login`,
			channel: 'feuillet-google-oauth',
			windowName: 'feuillet-google',
			take: (message) =>
				typeof message.ticket === 'string' && TICKET.test(message.ticket)
					? message.ticket
					: undefined,
			errorText,
			blockedText: t('Allow pop-ups for this site to sign in with Google.'),
		});
		return { ticket: result, cancel };
	}
}

export const googleSignInService = new GoogleSignInService();
