// src/components/profile/ProfileDevicesSection.tsx
// The devices signed in to the account, as Overleaf's sessions: when each
// signed in and was last used, with its browser and system; one may sign
// out any other, or all of them, such as after using a shared computer.
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';

import { t } from '@/i18n';
import { useAuth } from '../../hooks/useAuth';
import {
	type AccountDevice,
	type AccountSyncStatus,
	accountSyncService,
} from '../../services/AccountSyncService';
import ServerAccountLinkForm from './ServerAccountLinkForm';

const dateOf = (time: number) =>
	new Date(time).toLocaleString(undefined, {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	});

const nameOf = (device: AccountDevice) =>
	device.browser && device.os
		? t('{browser} on {os}', { browser: device.browser, os: device.os })
		: device.browser || device.os || t('Unknown device');

const ProfileDevicesSection: React.FC = () => {
	const { user, isGuestUser } = useAuth();
	const [status, setStatus] = useState<AccountSyncStatus>(
		accountSyncService.getStatus(),
	);
	const [devices, setDevices] = useState<AccountDevice[] | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => accountSyncService.addListener(setStatus), []);
	const linked = status.state !== 'signed-out' && accountSyncService.isLinked();

	const load = useCallback(
		async (change?: { revoke: string } | { others: true }) => {
			setError(null);
			try {
				setDevices(await accountSyncService.accountDevices(change));
			} catch {
				setError(t('The server could not be reached. Please try again later.'));
			}
		},
		[],
	);

	useEffect(() => {
		if (linked) void load();
	}, [linked, load]);

	if (!user || isGuestUser(user)) return null;

	const run = async (
		key: string,
		change: { revoke: string } | { others: true },
	) => {
		setBusy(key);
		try {
			await load(change);
		} finally {
			setBusy(null);
		}
	};
	const others = (devices ?? []).filter((device) => !device.current);

	return (
		<div className='ui-stack devices-section' data-gap='sm'>
			<h3>{t('Signed-in devices')}</h3>
			<p>
				{t(
					'Your account stays signed in on each device for 90 days after it was last used. Sign out a device you no longer use, or after using a shared computer.',
				)}
			</p>

			{!linked ? (
				<ServerAccountLinkForm
					reason={t('Devices sign in to your account on the server.')}
					onLinked={() => setStatus(accountSyncService.getStatus())}
				/>
			) : (
				<>
					{error && (
						<div className='ui-message' data-tone='warning'>
							{error}
						</div>
					)}
					{devices && (
						<ul className='account-devices' data-role='account-devices'>
							{devices.map((device) => (
								<li
									key={device.id}
									data-device={device.id}
									data-current={device.current ? 'true' : undefined}
								>
									<div>
										<strong>{nameOf(device)}</strong>
										{device.current && (
											<span className='ui-badge' data-role='this-device'>
												{t('This device')}
											</span>
										)}
										<span className='ui-meta'>
											{t('Signed in on {date}, last used on {used}', {
												date: dateOf(device.createdAt),
												used: dateOf(device.lastUsedAt),
											})}
										</span>
									</div>
									{!device.current && (
										<button
											type='button'
											className='button secondary'
											data-action='sign-out-device'
											disabled={busy !== null}
											aria-busy={busy === device.id}
											onClick={() => void run(device.id, { revoke: device.id })}
										>
											{t('Sign out')}
										</button>
									)}
								</li>
							))}
						</ul>
					)}
					{others.length > 0 && (
						<div className='ui-actions' data-align='end'>
							<button
								type='button'
								className='button danger'
								data-action='sign-out-other-devices'
								disabled={busy !== null}
								aria-busy={busy === 'others'}
								onClick={() => void run('others', { others: true })}
							>
								{t('Sign out all other devices')}
							</button>
						</div>
					)}
					{devices && others.length === 0 && (
						<p className='ui-meta'>{t('No other device is signed in.')}</p>
					)}
				</>
			)}
		</div>
	);
};

export default ProfileDevicesSection;
