// src/hooks/useGitRemoteAccount.ts
import { useCallback, useEffect, useState } from 'react';

import { APP_NAME } from '@/branding';
import { t } from '@/i18n';
import type { SecretsContextType } from '../contexts/SecretsContext';
import type { GitRemoteAccount, GitRemoteProvider } from '../types/gitRemote';
import { useSecrets } from './useSecrets';

export type GitActionSecrets = Pick<
	SecretsContextType,
	'getSecret' | 'setSecret'
>;

/**
 * The account-level token of a Git provider (stored once, globally) and the
 * signed-in account it belongs to.
 */
export const useGitRemoteAccount = (
	provider: GitRemoteProvider,
	active: boolean,
) => {
	const { getSecret, setSecret, hasSecret } = useSecrets();
	const [hasToken, setHasToken] = useState(false);
	const [account, setAccount] = useState<GitRemoteAccount | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	/* biome-ignore lint/correctness/useExhaustiveDependencies(active): Becoming active re-reads the stored account credential. */
	useEffect(() => {
		setHasToken(
			hasSecret(provider.backupPluginId, provider.backupTokenSecretKey, {
				scope: 'global',
			}),
		);
	}, [active, hasSecret, provider]);

	// One action can read the same secret several times (status, push, ...).
	// Sharing the reads asks for the account password at most once per action.
	const createActionSecrets = useCallback((): GitActionSecrets => {
		const reads = new Map<string, ReturnType<typeof getSecret>>();
		return {
			getSecret: (pluginId, secretKey, options) => {
				const key = [
					pluginId,
					secretKey,
					options?.scope ?? 'global',
					options?.projectId ?? '',
				].join('\u0000');
				let read = reads.get(key);
				if (!read) {
					read = getSecret(pluginId, secretKey, options);
					reads.set(key, read);
				}
				return read;
			},
			setSecret,
		};
	}, [getSecret, setSecret]);

	const readToken = useCallback(
		async (secrets: GitActionSecrets): Promise<string> => {
			const secret = await secrets.getSecret(
				provider.backupPluginId,
				provider.backupTokenSecretKey,
				{ scope: 'global' },
			);
			const value = secret?.value?.trim();
			if (!value) {
				throw new Error(
					t('Your {provider} token is unavailable. Enter it again.', {
						provider: provider.displayName,
					}),
				);
			}
			return value;
		},
		[provider],
	);

	const accountForToken = useCallback(
		async (accountToken: string): Promise<GitRemoteAccount> => {
			if (provider.getAccount) return provider.getAccount(accountToken);
			if (!(await provider.testConnection(accountToken))) {
				throw new Error(
					t('{provider} did not accept the saved token.', {
						provider: provider.displayName,
					}),
				);
			}
			return { login: provider.displayName };
		},
		[provider],
	);

	useEffect(() => {
		if (!active || !hasToken || account) return;
		let current = true;
		setIsLoading(true);
		setError(null);
		readToken(createActionSecrets())
			.then(accountForToken)
			.then((loaded) => {
				if (current) setAccount(loaded);
			})
			.catch((accountError) => {
				if (current) {
					setError(
						accountError instanceof Error
							? accountError.message
							: t('Git action failed'),
					);
				}
			})
			.finally(() => {
				if (current) setIsLoading(false);
			});
		return () => {
			current = false;
		};
	}, [
		account,
		accountForToken,
		active,
		createActionSecrets,
		hasToken,
		readToken,
	]);

	const connectToken = useCallback(
		async (value: string): Promise<void> => {
			const accountToken = value.trim();
			if (!accountToken) throw new Error(t('A credential is required'));
			if (!(await provider.testConnection(accountToken))) {
				throw new Error(
					t('{provider} did not accept this token.', {
						provider: provider.displayName,
					}),
				);
			}
			await setSecret(
				provider.backupPluginId,
				provider.backupTokenSecretKey,
				accountToken,
				{
					scope: 'global',
					metadata: { tokenType: `${provider.id}-personal-access-token` },
					passwordMessage: t(
						'Enter your {app} password to encrypt and save your {provider} token in this browser:',
						{ app: APP_NAME, provider: provider.displayName },
					),
				},
			);
			const connected = await accountForToken(accountToken);
			setError(null);
			setAccount(connected);
			setHasToken(true);
		},
		[accountForToken, provider, setSecret],
	);

	return {
		hasToken,
		account,
		isLoading,
		error,
		createActionSecrets,
		readToken,
		connectToken,
	};
};
