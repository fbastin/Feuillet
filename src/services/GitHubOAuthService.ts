// src/services/GitHubOAuthService.ts
import { t } from '@/i18n';
import { availabilityCache, openOAuthPopup } from './OAuthPopup';

export interface GitHubSignIn {
	/** The token, once the user approved Feuillet on GitHub. */
	token: Promise<string>;
	/** Stops waiting, and closes the window when it can. */
	cancel: () => void;
}

const errorText = (error?: string): string => {
	if (error === 'denied') return t('GitHub sign-in was cancelled.');
	if (error === 'expired') {
		return t('The GitHub sign-in took too long. Try again.');
	}
	return t('GitHub did not complete the sign-in. Try again later.');
};

/**
 * "Sign in with GitHub", as on Overleaf: the collaboration server runs
 * GitHub's OAuth flow in a window it opens and hands the token back to this
 * page, which keeps it like a personal access token.
 */
class GitHubOAuthService {
	/** Whether the collaboration server has a GitHub OAuth App. */
	isAvailable = availabilityCache('/github/config');

	/** @param workflow Ask GitHub for « workflow » too (GitHub Actions files). */
	signIn(baseUrl: string, { workflow = false } = {}): GitHubSignIn {
		const { result, cancel } = openOAuthPopup<string>({
			loginUrl: `${baseUrl}/github/login${workflow ? '?workflow=1' : ''}`,
			channel: 'feuillet-github-oauth',
			windowName: 'feuillet-github',
			take: (message) =>
				typeof message.token === 'string' && message.token
					? message.token
					: undefined,
			errorText,
			blockedText: t('Allow pop-ups for this site to sign in with GitHub.'),
		});
		return { token: result, cancel };
	}
}

export const gitHubOAuthService = new GitHubOAuthService();
