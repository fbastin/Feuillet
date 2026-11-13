// src/components/profile/ProfileTwoFactorSection.tsx
// Two-factor authentication, as Overleaf's: signing in on a device then
// also takes the code that an authenticator app shows (server/collab/
// totp.js). Turned on by scanning a QR code, or typing its key, then giving
// one of its codes; recovery codes, made then if the account has none,
// replace a code when the phone is lost. Turned off with the password and a
// code. The devices signed in already stay.
import QRCode from 'qrcode';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { t } from '@/i18n';
import { useAuth } from '../../hooks/useAuth';
import { authService } from '../../services/AuthService';
import {
	AccountServerError,
	type AccountSyncStatus,
	type TwoFactorStatus,
	accountSyncService,
} from '../../services/AccountSyncService';

const dateOf = (time: number) =>
	new Date(time).toLocaleDateString(undefined, { dateStyle: 'long' });

// The key in groups of four, easier to type.
const grouped = (secret: string) => secret.replace(/(.{4})(?=.)/g, '$1 ');

const errorOf = (caught: unknown): string => {
	const code = caught instanceof AccountServerError ? caught.code : '';
	switch (code) {
		case 'wrong_password':
			return t('Invalid password');
		case 'wrong_code':
			return t(
				'This code is not right, or was already used. Enter the one your app shows now.',
			);
		case 'setup_expired':
			return t('The setup took too long: begin again.');
		case 'too_many_attempts':
			return t('Too many attempts. Please try again in a few minutes.');
		case 'not_found':
			return t('The server does not offer two-factor authentication yet.');
		default:
			return t('The server could not be reached. Please try again later.');
	}
};

const ProfileTwoFactorSection: React.FC = () => {
	const { user, isGuestUser } = useAuth();
	const [status, setStatus] = useState<AccountSyncStatus>(
		accountSyncService.getStatus(),
	);
	const [twoFactor, setTwoFactor] = useState<TwoFactorStatus | null>(null);
	const [password, setPassword] = useState('');
	const [code, setCode] = useState('');
	// The new key, while it is being set up.
	const [setup, setSetup] = useState<{
		secret: string;
		uri: string;
		qr: string;
	} | null>(null);
	const [codes, setCodes] = useState<string[] | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [done, setDone] = useState<string | null>(null);
	// A setup left before a code turned it on: told, so as not to be taken
	// for on.
	const [left, setLeft] = useState<string | null>(null);
	const settingUp = useRef(false);
	settingUp.current = !!setup;
	useEffect(
		() => () => {
			if (!settingUp.current) return;
			document.dispatchEvent(
				new CustomEvent('toast-notification', {
					detail: {
						type: 'error',
						message: t(
							'Two-factor authentication is not on: its setup was left before a code of your app turned it on. Set it up again from your profile, and replace the Feuillet entry of your app with the new one.',
						),
						duration: 20000,
					},
				}),
			);
		},
		[],
	);

	useEffect(() => accountSyncService.addListener(setStatus), []);
	const linked = status.state !== 'signed-out' && accountSyncService.isLinked();

	const load = useCallback(async () => {
		try {
			const status = await accountSyncService.twoFactorStatus();
			setTwoFactor(status);
			// This device then knows whether signing in asks for a code.
			const current = authService.getCurrentUser();
			if (status && current) {
				void authService.rememberTwoFactor(current.id, status.enabled);
			}
		} catch {
			setTwoFactor(null);
		}
	}, []);

	useEffect(() => {
		if (linked) void load();
	}, [linked, load]);

	if (!user || isGuestUser(user) || !linked || !twoFactor) return null;

	const run = async (action: () => Promise<void>) => {
		setBusy(true);
		setError(null);
		setDone(null);
		setLeft(null);
		try {
			await action();
		} catch (caught) {
			setError(errorOf(caught));
		} finally {
			setBusy(false);
		}
	};

	const begin = (event: React.FormEvent) => {
		event.preventDefault();
		void run(async () => {
			const made = await accountSyncService.beginTwoFactor(password);
			if (!made) return;
			const qr = await QRCode.toDataURL(made.uri, {
				width: 200,
				margin: 2,
				color: { dark: '#000000', light: '#ffffff' },
			});
			setSetup({ ...made, qr });
			setPassword('');
			setCode('');
		});
	};

	const confirm = (event: React.FormEvent) => {
		event.preventDefault();
		void run(async () => {
			const result = await accountSyncService.confirmTwoFactor(code.trim());
			if (!result) return;
			setTwoFactor(result);
			setCodes(result.codes ?? null);
			setSetup(null);
			setCode('');
			setDone(t('Two-factor authentication is on.'));
			void authService.rememberTwoFactor(user.id, true);
		});
	};

	const turnOff = (event: React.FormEvent) => {
		event.preventDefault();
		void run(async () => {
			const result = await accountSyncService.disableTwoFactor(
				password,
				code.trim(),
			);
			if (!result) return;
			setTwoFactor(result);
			setPassword('');
			setCode('');
			setCodes(null);
			setDone(t('Two-factor authentication is off.'));
			void authService.rememberTwoFactor(user.id, false);
		});
	};

	const codesText = () =>
		[
			t('Feuillet recovery codes for {username}', { username: user.username }),
			t(
				'Each code works once: in place of the code of your authenticator app when signing in, or to choose a new password from the sign-in page.',
			),
			'',
			...(codes ?? []),
		].join('\n');

	const download = () => {
		const url = URL.createObjectURL(
			new Blob([`${codesText()}\n`], { type: 'text/plain' }),
		);
		const link = document.createElement('a');
		link.href = url;
		link.download = `feuillet-recovery-codes-${user.username}.txt`;
		link.click();
		URL.revokeObjectURL(url);
	};

	return (
		<div
			className='ui-stack recovery-section'
			data-gap='sm'
			data-role='two-factor'
		>
			<h3>{t('Two-factor authentication')}</h3>
			<p>
				{t(
					'Signing in on a new device, or after logging out, then also takes the code that an app on your phone shows, such as Ente Auth, Google Authenticator, Aegis, FreeOTP or a password manager: your password alone is no longer enough.',
				)}
			</p>

			{done && (
				<div className='ui-message' data-tone='success'>
					{done}
				</div>
			)}
			{error && (
				<div className='ui-message' data-tone='error'>
					{error}
				</div>
			)}
			{left && (
				<div
					className='ui-message'
					data-tone='warning'
					data-role='two-factor-left'
				>
					{left}
				</div>
			)}

			{codes && codes.length > 0 && (
				<div className='ui-message ui-stack' data-tone='warning' data-gap='xs'>
					<strong>
						{t(
							'Without your phone, these recovery codes replace a code, once each. Keep them somewhere safe, such as a password manager: they will not be shown again.',
						)}
					</strong>
					<ol className='recovery-codes' data-role='two-factor-recovery-codes'>
						{codes.map((entry) => (
							<li key={entry}>
								<code>{entry}</code>
							</li>
						))}
					</ol>
					<div className='ui-actions'>
						<button
							type='button'
							className='button secondary'
							onClick={() => void navigator.clipboard.writeText(codesText())}
						>
							{t('Copy')}
						</button>
						<button
							type='button'
							className='button secondary'
							onClick={download}
						>
							{t('Download')}
						</button>
					</div>
				</div>
			)}

			{twoFactor.enabled ? (
				<>
					<p className='ui-meta' data-role='two-factor-status' data-state='on'>
						{twoFactor.enabledAt
							? t('On since {date}. Recovery codes left: {codes}.', {
									date: dateOf(twoFactor.enabledAt),
									codes: twoFactor.recoveryCodes,
								})
							: t('On. Recovery codes left: {codes}.', {
									codes: twoFactor.recoveryCodes,
								})}
					</p>
					<form className='ui-stack' data-gap='xs' onSubmit={turnOff}>
						<div className='ui-field'>
							<label htmlFor='two-factor-off-password'>{t('Password')}</label>
							<input
								type='password'
								id='two-factor-off-password'
								value={password}
								onChange={(event) => setPassword(event.target.value)}
								autoComplete='current-password'
								disabled={busy}
							/>
						</div>
						<div className='ui-field'>
							<label htmlFor='two-factor-off-code'>
								{t('Code of your app, or a recovery code')}
							</label>
							<input
								id='two-factor-off-code'
								value={code}
								onChange={(event) => setCode(event.target.value)}
								autoComplete='one-time-code'
								disabled={busy}
							/>
						</div>
						<div className='ui-actions' data-align='end'>
							<button
								type='submit'
								className='button danger'
								data-action='turn-off-two-factor'
								disabled={busy || !password || !code.trim()}
							>
								{t('Turn off two-factor authentication')}
							</button>
						</div>
					</form>
				</>
			) : setup ? (
				<form className='ui-stack' data-gap='xs' onSubmit={confirm}>
					<div
						className='ui-message'
						data-tone='warning'
						data-role='two-factor-pending'
						role='status'
					>
						{t(
							'Not on yet: it is once a code of your app, entered below, turns it on.',
						)}
					</div>
					<ol className='two-factor-steps'>
						<li>
							{t(
								'In your authenticator app, add an account by scanning this QR code, or by typing the key under it.',
							)}
						</li>
						<li>
							{t('Enter the 6-digit code that the app shows for Feuillet.')}
						</li>
						<li>{t('Click "Turn on".')}</li>
					</ol>
					<img
						src={setup.qr}
						alt={t('QR code of the key for your authenticator app')}
						width={200}
						height={200}
						data-role='two-factor-qr'
					/>
					<p className='ui-meta'>
						{t('Key:')}{' '}
						<code data-role='two-factor-secret'>{grouped(setup.secret)}</code>
					</p>
					<div className='ui-field'>
						<label htmlFor='two-factor-code'>{t('Code')}</label>
						<input
							id='two-factor-code'
							value={code}
							onChange={(event) => setCode(event.target.value)}
							autoComplete='one-time-code'
							inputMode='numeric'
							disabled={busy}
						/>
					</div>
					<button
						type='submit'
						className='button primary'
						data-action='confirm-two-factor'
						disabled={busy || !code.trim()}
					>
						{t('Turn on')}
					</button>
					<button
						type='button'
						className='button'
						data-variant='text'
						onClick={() => {
							setSetup(null);
							setLeft(
								t(
									'Two-factor authentication was not turned on. Remove from your app the Feuillet entry you may have added.',
								),
							);
						}}
						disabled={busy}
					>
						{t('Cancel')}
					</button>
				</form>
			) : (
				<form className='ui-stack' data-gap='xs' onSubmit={begin}>
					<p className='ui-meta' data-role='two-factor-status' data-state='off'>
						{t('Off: signing in takes your password alone.')}
					</p>
					<div className='ui-field'>
						<label htmlFor='two-factor-password'>
							{t('Your password, to set it up')}
						</label>
						<input
							type='password'
							id='two-factor-password'
							value={password}
							onChange={(event) => setPassword(event.target.value)}
							autoComplete='current-password'
							disabled={busy}
						/>
					</div>
					<div className='ui-actions' data-align='end'>
						<button
							type='submit'
							className='button primary'
							data-action='begin-two-factor'
							disabled={busy || !password}
						>
							{t('Set up two-factor authentication')}
						</button>
					</div>
					<p className='ui-meta'>
						{t(
							'The devices signed in already stay signed in; the Devices tab signs them out.',
						)}
					</p>
				</form>
			)}
		</div>
	);
};

export default ProfileTwoFactorSection;
