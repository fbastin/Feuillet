// src/components/profile/ProfileServerAccountSection.tsx
import type React from 'react';
import { useEffect, useState } from 'react';

import { t } from '@/i18n';
import { useAuth } from '../../hooks/useAuth';
import {
	type AccountSyncStatus,
	accountSyncService,
} from '../../services/AccountSyncService';
import { linkServerAccount } from './serverAccountLink';

interface ProfileServerAccountSectionProps {
	isSubmitting: boolean;
	setIsSubmitting: (value: boolean) => void;
	onError: (message: string | null) => void;
	onSuccess: (message: string | null) => void;
}

const hostOf = (server?: string) => {
	try {
		return server ? new URL(server).host : '';
	} catch {
		return server ?? '';
	}
};

// Shows whether the projects of this account are kept on the server, so
// that they can be opened on other devices, and links the account if not.
const ProfileServerAccountSection: React.FC<
	ProfileServerAccountSectionProps
> = ({ isSubmitting, setIsSubmitting, onError, onSuccess }) => {
	const { user, isGuestUser, verifyPassword } = useAuth();
	const [status, setStatus] = useState<AccountSyncStatus>(
		accountSyncService.getStatus(),
	);
	const [password, setPassword] = useState('');

	useEffect(() => accountSyncService.addListener(setStatus), []);

	if (!user || isGuestUser(user)) return null;

	const linked =
		!!status.username &&
		status.state !== 'unlinked' &&
		status.state !== 'signed-out';

	const handleSync = async () => {
		onError(null);
		onSuccess(null);
		setIsSubmitting(true);
		try {
			await accountSyncService.sync(user.id);
			if (accountSyncService.getStatus().state === 'offline') {
				onError(t('The server could not be reached. Please try again later.'));
			}
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleLink = async () => {
		onError(null);
		onSuccess(null);
		setIsSubmitting(true);
		try {
			const result = await linkServerAccount(user, password, verifyPassword);
			if (result.linked) {
				setPassword('');
				onSuccess(result.message);
			} else {
				onError(result.message);
			}
		} finally {
			setIsSubmitting(false);
		}
	};

	const statusText =
		status.state === 'syncing'
			? t('Synchronizing...')
			: status.state === 'offline'
				? t('The server could not be reached; it will be tried again.')
				: status.lastSync
					? t('Last synchronized at {time}', {
							time: new Date(status.lastSync).toLocaleTimeString(),
						})
					: '';

	return (
		<div className='ui-stack' data-gap='sm'>
			<h3 style={{ paddingTop: '1rem' }}>{t('Server Account')}</h3>

			{linked ? (
				<>
					<p>
						{t(
							'Your projects are kept with the account "{username}" on {server}. Log in with it on any device to find them.',
							{ username: status.username, server: hostOf(status.server) },
						)}
					</p>
					{statusText && (
						<p
							className='ui-message'
							data-tone={status.state === 'offline' ? 'warning' : 'info'}
							data-density='compact'
						>
							{statusText}
						</p>
					)}
					<div className='ui-actions' data-gap='xs'>
						<button
							type='button'
							className='button secondary'
							onClick={handleSync}
							disabled={isSubmitting || status.state === 'syncing'}
						>
							{t('Synchronize now')}
						</button>
					</div>
				</>
			) : (
				<>
					<p>
						{status.state === 'signed-out'
							? t(
									'This browser was signed out of the server account, for example because its password was changed on another device.',
								)
							: t(
									'This account only exists in this browser. Link it to the server to find your projects on your other devices.',
								)}
					</p>
					<div className='ui-field'>
						<label htmlFor='server-account-password'>{t('Password')}</label>
						<input
							type='password'
							id='server-account-password'
							value={password}
							onChange={(event) => setPassword(event.target.value)}
							autoComplete='current-password'
							disabled={isSubmitting}
						/>
					</div>
					<div className='ui-actions' data-gap='xs'>
						<button
							type='button'
							className='button primary'
							onClick={handleLink}
							disabled={isSubmitting || !password}
						>
							{t('Link to the server')}
						</button>
					</div>
				</>
			)}
		</div>
	);
};

export default ProfileServerAccountSection;
