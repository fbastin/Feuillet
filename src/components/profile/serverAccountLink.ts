// src/components/profile/serverAccountLink.ts
import { t } from '@/i18n';
import { authService } from '../../services/AuthService';
import type { User } from '../../types/auth';

/**
 * Links an account of this browser to the server account of the same name,
 * made then if need be, with its password: what the profile and the Share
 * dialog offer when the account is not linked yet.
 */
export async function linkServerAccount(
	user: User,
	password: string,
	verifyPassword: (userId: string, password: string) => Promise<boolean>,
	code?: string,
): Promise<{ linked: boolean; message: string; needsCode?: boolean }> {
	if (!(await verifyPassword(user.id, password))) {
		return { linked: false, message: t('Current password is incorrect') };
	}
	const result = await authService.linkAccount(user, password, code);
	if (result === 'linked') {
		return {
			linked: true,
			message: t('Your projects are now kept on the server.'),
		};
	}
	// Two-factor authentication: the code too.
	if (result === 'code_required' || result === 'wrong_code') {
		return {
			linked: false,
			needsCode: true,
			message:
				result === 'code_required'
					? t('Enter the code that your authenticator app shows.')
					: t(
							'This code is not right, or was already used. Enter the one your app shows now.',
						),
		};
	}
	return {
		linked: false,
		message:
			result === 'taken'
				? t(
						'The server already has an account named "{username}" with another password. If you changed it on another device, log out and log in again with the new password.',
						{ username: user.username },
					)
				: t('The server could not be reached. Please try again later.'),
	};
}
