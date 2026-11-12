// src/components/auth/Register.tsx
import type React from 'react';
import { useEffect, useState } from 'react';

import i18next, { t } from '@/i18n';
import { CHELYS_ACCOUNTS_ENABLED } from '../../branding';
import PasswordInfo from './PasswordInfo';
import { useAuth } from '../../hooks/useAuth';
import { useChelys } from '../../hooks/useChelys';
import {
	AccountServerError,
	type SignUpOptions,
	accountSyncService,
} from '../../services/AccountSyncService';
import { TwoFactorRequiredError } from '../../services/AuthService';
import { notificationService } from '../../services/NotificationService';
import {
	validateEmail,
	validatePassword,
	validateUsername,
} from '../../utils/authUtils';
import { replaceHash, signUpAdmissionOf, signUpOf } from '../../utils/urlUtils';
import CopyField from '../common/CopyField';
import { PasskeyIcon } from '../common/Icons';
import {
	PROVIDER_NAMES,
	type ProviderTicket,
} from '../../services/ExternalSignInService';
import ExternalSignInButton, {
	useAvailableProviders,
} from './ExternalSignInButton';

// The address given becomes the account's once the link mailed to it
// confirms it, as on Overleaf. Mailing takes some seconds: the sign-up does
// not wait for it.
const confirmEmailLater = (address: string, password: string): void => {
	const operationId = 'confirm-sign-up-email';
	accountSyncService
		.confirmSignUpEmail(address, password, i18next.language)
		.then((status) => {
			if (status?.pending) {
				notificationService.showSuccess(
					t(
						'A link was sent to {address}: open it to confirm your email address. It works for 24 hours.',
						{ address: status.pending },
					),
					{ operationId, duration: 10000 },
				);
			}
		})
		.catch((error) => {
			const code = error instanceof AccountServerError ? error.code : '';
			notificationService.showError(
				code === 'email_taken'
					? t(
							'{address} is already the email address of another account: give another in your profile.',
							{ address },
						)
					: t(
							'The confirmation link could not be sent to {address}: send it again from your profile.',
							{ address },
						),
				{ operationId },
			);
		});
};

// Where accounts need an invitation (server/collab/accounts.js), without
// one: how to get one, and a link mailed to an address of the domains the
// server allows, if any.
const InvitationNeeded: React.FC<{
	domains: string[];
	onSwitchToLogin: () => void;
}> = ({ domains, onSwitchToLogin }) => {
	const [address, setAddress] = useState('');
	const [sending, setSending] = useState(false);
	const [sentTo, setSentTo] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const listed = domains.join(', ');

	const send = async (e: React.SyntheticEvent<HTMLFormElement>) => {
		e.preventDefault();
		const email = address.trim();
		if (!email) return;
		setSending(true);
		setError(null);
		try {
			await accountSyncService.mailSignUpLink(email, i18next.language);
			setSentTo(email);
		} catch (caught) {
			const code = caught instanceof AccountServerError ? caught.code : '';
			setError(
				code === 'domain_not_allowed'
					? t('Only addresses at {domains} may ask for a link.', {
							domains: listed,
						})
					: code === 'invalid_email'
						? t('Please enter a valid email address')
						: code === 'too_many_attempts'
							? t('Too many attempts. Please try again in a few minutes.')
							: t('The link could not be sent. Please try again later.'),
			);
		} finally {
			setSending(false);
		}
	};

	return (
		<div className='auth-form-container' data-role='sign-up-invitation'>
			<h2>{t('Create an Account')}</h2>
			<div className='ui-message' data-tone='info'>
				{t(
					'Accounts on this server are made by invitation: ask a member to invite you to a project, or an administrator for a link to create an account.',
				)}
			</div>
			{domains.length > 0 &&
				(sentTo ? (
					<div className='ui-message' data-tone='success'>
						{t(
							'A link to create your account was sent to {address}. It works once, for 24 hours.',
							{ address: sentTo },
						)}
					</div>
				) : (
					<form onSubmit={send} className='ui-stack'>
						{error && (
							<div className='ui-message' data-tone='error'>
								{error}
							</div>
						)}
						<div className='ui-field' data-spacing='section'>
							<label htmlFor='sign-up-email'>
								{t('With an address at {domains}, ask for a link here:', {
									domains: listed,
								})}
							</label>
							<input
								type='email'
								id='sign-up-email'
								value={address}
								onChange={(e) => setAddress(e.target.value)}
								disabled={sending}
								autoComplete='email'
								required
							/>
						</div>
						<button
							type='submit'
							className='button primary'
							data-state={sending ? 'loading' : undefined}
							disabled={sending || !address.trim()}
						>
							{t('Send me a link')}
						</button>
					</form>
				))}
			<div className='ui-actions' data-align='center' data-wrap='true'>
				<span>{t('Already have an account?')}</span>
				<button
					type='button'
					className='button'
					data-variant='text'
					onClick={onSwitchToLogin}
				>
					{t('Log in')}
				</button>
			</div>
		</div>
	);
};

interface RegisterProps {
	onRegisterSuccess: () => void;
	onSwitchToLogin: () => void;
	onShowPrivacy: () => void;
	isUpgrade?: boolean;
	upgradeFunction?: (
		username: string,
		password: string,
		email?: string,
	) => Promise<any>;
	/**
	 * Google's or ORCID's sign-in for an account of theirs linked to no
	 * account: the account created here is linked to it.
	 */
	link?: ProviderTicket | null;
	onLink?: (link: ProviderTicket | null) => void;
}

const Register: React.FC<RegisterProps> = ({
	onRegisterSuccess,
	onSwitchToLogin,
	onShowPrivacy,
	isUpgrade = false,
	upgradeFunction,
	link = null,
	onLink,
}) => {
	const { register, loginWithProvider } = useAuth();
	const providers = useAvailableProviders();
	const { chelysRegister } = useChelys();

	const [username, setUsername] = useState('');
	const [password, setPassword] = useState('');
	const [confirmPassword, setConfirmPassword] = useState('');
	const [ageConfirmed, setAgeConfirmed] = useState(false);
	const [privacyAccepted, setPrivacyAccepted] = useState(false);
	const [email, setEmail] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [chelysPrfHex, setChelysPrfHex] = useState<string | null>(null);
	// Who may create an account on the server; null until it tells.
	const [signUp, setSignUp] = useState<SignUpOptions | null>(null);
	const admitted =
		Object.keys(signUpAdmissionOf(window.location.hash)).length > 0;

	useEffect(() => {
		let current = true;
		void accountSyncService.signUpOptions().then((options) => {
			if (current) setSignUp(options);
		});
		return () => {
			current = false;
		};
	}, []);

	const validate = (): boolean => {
		const fieldError =
			validateUsername(username) ||
			validatePassword(password) ||
			validateEmail(email);
		if (fieldError) {
			setError(fieldError);
			return false;
		}
		if (password !== confirmPassword) {
			setError(t('Passwords do not match'));
			return false;
		}
		return true;
	};

	const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
		e.preventDefault();
		if (!validate()) return;

		setError(null);
		setIsLoading(true);

		try {
			const address = email.trim();
			if (isUpgrade && upgradeFunction) {
				await upgradeFunction(username, password, address || undefined);
			} else {
				await register(
					username,
					password,
					address || undefined,
					link ?? undefined,
				);
			}
			if (address) confirmEmailLater(address, password);
			// The link made its account.
			if (signUpOf(window.location.hash)) replaceHash('');
			onRegisterSuccess();
		} catch (error) {
			setError(
				error instanceof Error
					? error.message
					: t('An error occurred during {action}', {
							action: isUpgrade ? t('upgrade') : t('registration'),
						}),
			);
		} finally {
			setIsLoading(false);
		}
	};

	const handleChelysSubmit = async () => {
		if (!validate()) return;

		setError(null);
		setIsLoading(true);

		try {
			const prfHex = await chelysRegister(username, password);
			setChelysPrfHex(prfHex);
		} catch (error) {
			setError(
				error instanceof Error
					? error.message
					: t('An error occurred during {action}', {
							action: t('registration'),
						}),
			);
		} finally {
			setIsLoading(false);
		}
	};

	if (signUp?.mode === 'invitation' && !admitted) {
		return (
			<InvitationNeeded
				domains={signUp.domains}
				onSwitchToLogin={onSwitchToLogin}
			/>
		);
	}

	if (chelysPrfHex) {
		return (
			<div className='auth-form-container'>
				<h2>{t('Chelys Account Created')}</h2>
				<p>
					{t(
						'Copy this key into your Chelys app and log in there with the same username and password.',
					)}
				</p>
				<div className='ui-field' data-spacing='section'>
					<CopyField label={t('Chelys key')} value={chelysPrfHex} mono />
				</div>
				<button
					type='button'
					className='button primary'
					onClick={() => {
						onRegisterSuccess();
						window.location.reload();
					}}
				>
					{t('Continue')}
				</button>
			</div>
		);
	}

	return (
		<div className='auth-form-container'>
			<h2>
				{isUpgrade ? t('Upgrade to Full Account') : t('Create an Account')}
			</h2>

			{error && (
				<div className='ui-message' data-tone='error'>
					{error}
				</div>
			)}

			{!isUpgrade &&
				(link ? (
					<div
						className='ui-message'
						data-tone='info'
						data-role={`${link.provider}-sign-up-notice`}
					>
						<p>
							{t(
								'{provider} confirmed your {provider} account, which is not linked to a Feuillet account yet. Choose a name and a password: the account is linked to it, and {provider} then signs you in.',
								{ provider: PROVIDER_NAMES[link.provider] },
							)}
						</p>
						<button
							type='button'
							className='button'
							data-variant='text'
							data-action={`forget-${link.provider}-sign-up`}
							onClick={() => onLink?.(null)}
							disabled={isLoading}
						>
							{t('Do not link {provider}', {
								provider: PROVIDER_NAMES[link.provider],
							})}
						</button>
					</div>
				) : (
					providers.length > 0 && (
						<div className='ui-stack' data-gap='xs'>
							{providers.map((provider) => (
								<ExternalSignInButton
									key={provider}
									provider={provider}
									label={t('Sign up with {provider}', {
										provider: PROVIDER_NAMES[provider],
									})}
									disabled={isLoading}
									onStart={() => setError(null)}
									onTicket={async (ticket) => {
										// Already linked: that account opens; with two-factor
										// authentication, from the log-in page, which asks for
										// the code.
										let result: Awaited<ReturnType<typeof loginWithProvider>>;
										try {
											result = await loginWithProvider(provider, ticket);
										} catch (caught) {
											if (caught instanceof TwoFactorRequiredError) {
												setError(
													t(
														'This {provider} account is linked to an account with two-factor authentication: sign in with {provider} from the log-in page.',
														{ provider: PROVIDER_NAMES[provider] },
													),
												);
												return;
											}
											throw caught;
										}
										if (result === 'not-linked') {
											onLink?.({ provider, ticket });
											return;
										}
										onRegisterSuccess();
										window.location.reload();
									}}
									onError={setError}
								/>
							))}
							<div className='guest-divider'>
								<span>{t('or')}</span>
							</div>
						</div>
					)
				))}

			<form onSubmit={handleSubmit} className='ui-stack'>
				<div className='ui-field' data-spacing='section'>
					<label htmlFor='username'>
						{t('Username')}
						<span className='required'>*</span>
					</label>
					<input
						type='text'
						id='username'
						value={username}
						onChange={(e) => setUsername(e.target.value)}
						disabled={isLoading}
						autoComplete='username'
						required
					/>
				</div>

				<div className='ui-field' data-spacing='section'>
					<label htmlFor='email'>{t('Email')}</label>
					<input
						type='email'
						id='email'
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						disabled={isLoading}
						autoComplete='email'
						aria-describedby='email-help'
					/>
					<div id='email-help' className='ui-note ui-field-hint'>
						{t(
							'Optional. If you forget your password, Feuillet sends a link to this address; a first link confirms it. It is never shown to anyone.',
						)}
					</div>
				</div>

				<div className='ui-field' data-spacing='section'>
					<label htmlFor='password'>
						{t('Password')}
						<span className='required'>*</span>
					</label>
					<input
						type='password'
						id='password'
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						disabled={isLoading}
						autoComplete='new-password'
						required
					/>
					<PasswordInfo />
				</div>

				<div className='ui-field' data-spacing='section'>
					<label htmlFor='confirmPassword'>
						{t('Confirm Password')}
						<span className='required'>*</span>
					</label>
					<input
						type='password'
						id='confirmPassword'
						value={confirmPassword}
						onChange={(e) => setConfirmPassword(e.target.value)}
						disabled={isLoading}
						autoComplete='new-password'
						required
					/>
				</div>

				{/* Agreed before the button they unlock, not under it. */}
				<div className='ui-stack auth-consent-fields' data-gap='xs'>
					<div className='ui-field'>
						<label className='checkbox-control'>
							<input
								type='checkbox'
								checked={ageConfirmed}
								onChange={(e) => setAgeConfirmed(e.target.checked)}
								required
							/>

							<span>{t('I confirm I am at least 16 years old')}</span>
						</label>
					</div>

					<div className='ui-field'>
						<label className='checkbox-control'>
							<input
								type='checkbox'
								checked={privacyAccepted}
								onChange={(e) => setPrivacyAccepted(e.target.checked)}
								required
							/>

							<span>
								{t('I understand how my data is handled as described in the')}{' '}
								<button
									type='button'
									className='button'
									data-variant='text'
									onClick={onShowPrivacy}
								>
									{t('privacy information')}
								</button>
							</span>
						</label>
					</div>
				</div>

				<button
					type='submit'
					className='button primary'
					data-state={isLoading ? 'loading' : undefined}
					disabled={!ageConfirmed || !privacyAccepted || isLoading}
				>
					{isLoading
						? isUpgrade
							? t('Upgrading...')
							: t('Creating Account...')
						: isUpgrade
							? t('Upgrade Account')
							: t('Sign up')}
				</button>

				{CHELYS_ACCOUNTS_ENABLED && !isUpgrade && (
					<button
						type='button'
						className='button'
						data-tone='accent'
						data-state={isLoading ? 'loading' : undefined}
						onClick={handleChelysSubmit}
						disabled={!ageConfirmed || !privacyAccepted || isLoading}
					>
						<span>
							{isLoading ? t('Creating Account...') : t('Sign up with Chelys')}
						</span>
						<span className='ui-badge' data-variant='label' data-tone='accent'>
							<PasskeyIcon size={24} />
							{t('Passkey')}
						</span>
					</button>
				)}
			</form>

			{!isUpgrade && (
				<div className='ui-actions' data-align='center' data-wrap='true'>
					<span>{t('Already have an account?')}</span>
					<button
						type='button'
						className='button'
						data-variant='text'
						onClick={onSwitchToLogin}
						disabled={isLoading}
					>
						{t('Log in')}
					</button>
				</div>
			)}
		</div>
	);
};

export default Register;
