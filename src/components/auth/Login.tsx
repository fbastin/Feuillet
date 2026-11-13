// src/components/auth/Login.tsx
import type React from 'react';
import { useState } from 'react';

import { t } from '@/i18n';
import { createNamedLogger } from '@/logging';
import { CHELYS_ACCOUNTS_ENABLED } from '../../branding';
import { useAuth } from '../../hooks/useAuth';
import { useChelys } from '../../hooks/useChelys';
import {
	ChelysAccountNotFoundError,
	getTempPrf,
	clearTempPrf,
} from '../../utils/chelysWebauthn';
import {
	PROVIDER_NAMES,
	type ProviderTicket,
	SIGN_IN_PROVIDERS,
	type SignInProvider,
} from '../../services/ExternalSignInService';
import {
	TwoFactorRequiredError,
	takeSignInNotice,
} from '../../services/AuthService';
import ExternalSignInButton from './ExternalSignInButton';
import GuestConsentModal from './GuestConsentModal';
import RecoverAccount from './RecoverAccount';
import PrivacyModal from '../common/PrivacyModal';
import { PasskeyIcon } from '../common/Icons';

const moduleLog = createNamedLogger('Login');

interface LoginProps {
	onLoginSuccess: () => void;
	/** With a ticket of Google's or ORCID's sign-in, to create an account linked to it. */
	onSwitchToRegister: (link?: ProviderTicket) => void;
	onSwitchToImport: () => void;
}

const Login: React.FC<LoginProps> = ({
	onLoginSuccess,
	onSwitchToRegister,
	onSwitchToImport,
}) => {
	const { login, loginWithProvider, createGuestAccount } = useAuth();
	const {
		chelysLogin,
		confirmChelysRegister,
		chelysLoginWithPrf,
		confirmChelysRegisterWithPrf,
		logoutChelys,
	} = useChelys();

	const [username, setUsername] = useState('');
	const [password, setPassword] = useState('');
	// Why the account was signed out, if it was (AuthService).
	const [error, setError] = useState<string | null>(takeSignInNotice);
	const [isLoading, setIsLoading] = useState(false);
	const [showGuestModal, setShowGuestModal] = useState(false);
	const [showPrivacy, setShowPrivacy] = useState(false);
	const [confirmCreate, setConfirmCreate] = useState(false);
	// A forgotten password, recovered with a recovery code.
	const [recovering, setRecovering] = useState(false);
	// Two-factor authentication: the sign-in that asked for a code, which
	// signs in again with it.
	const [codeFor, setCodeFor] = useState<
		| { kind: 'password' }
		| { kind: 'provider'; provider: SignInProvider; ticket: string }
		| null
	>(null);
	const [code, setCode] = useState('');

	const signedIn = () => {
		logoutChelys();
		onLoginSuccess();
		window.location.reload();
	};

	const submitCode = async (e: React.SyntheticEvent<HTMLFormElement>) => {
		e.preventDefault();
		if (!codeFor || !code.trim()) return;
		setError(null);
		setIsLoading(true);
		try {
			if (codeFor.kind === 'password') {
				await login(username, password, code.trim());
			} else {
				const result = await loginWithProvider(
					codeFor.provider,
					codeFor.ticket,
					code.trim(),
				);
				if (result === 'not-linked') {
					onSwitchToRegister({
						provider: codeFor.provider,
						ticket: codeFor.ticket,
					});
					return;
				}
			}
			signedIn();
		} catch (error) {
			setCode('');
			setError(
				error instanceof Error
					? error.message
					: t('An error occurred during {action}', { action: t('log in') }),
			);
		} finally {
			setIsLoading(false);
		}
	};

	const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
		e.preventDefault();

		if (!username || !password) {
			setError(t('Please enter both username and password'));
			return;
		}

		setError(null);
		setIsLoading(true);

		try {
			await login(username, password);
			signedIn();
		} catch (error) {
			if (error instanceof TwoFactorRequiredError) {
				setCode('');
				setCodeFor({ kind: 'password' });
				return;
			}
			setError(
				error instanceof Error
					? error.message
					: t('An error occurred during {action}', { action: t('log in') }),
			);
		} finally {
			setIsLoading(false);
		}
	};

	const handleChelysSubmit = async () => {
		if (!username || !password) {
			setError(t('Please enter both username and password'));
			return;
		}

		setError(null);
		setIsLoading(true);

		try {
			const tempPrf = getTempPrf();
			if (tempPrf) {
				await chelysLoginWithPrf(username, password, tempPrf);
			} else {
				await chelysLogin(username, password);
			}
			clearTempPrf();
			onLoginSuccess();
			window.location.reload();
		} catch (error) {
			if (error instanceof ChelysAccountNotFoundError) {
				setConfirmCreate(true);
			} else {
				setError(
					error instanceof Error
						? error.message
						: t('An error occurred during {action}', { action: t('log in') }),
				);
			}
		} finally {
			setIsLoading(false);
		}
	};

	const handleConfirmCreate = async () => {
		setError(null);
		setIsLoading(true);

		try {
			const tempPrf = getTempPrf();
			if (tempPrf) {
				await confirmChelysRegisterWithPrf(username, password, tempPrf);
			} else {
				await confirmChelysRegister(username, password);
			}
			clearTempPrf();
			onLoginSuccess();
			window.location.reload();
		} catch (error) {
			setError(
				error instanceof Error
					? error.message
					: t('An error occurred during {action}', { action: t('log in') }),
			);
		} finally {
			setIsLoading(false);
			setConfirmCreate(false);
		}
	};

	// Signed in to the account linked to that Google or ORCID account; or,
	// none being linked, on to creating one, as Overleaf does.
	const handleProviderTicket = async (
		provider: SignInProvider,
		ticket: string,
	) => {
		let result: Awaited<ReturnType<typeof loginWithProvider>>;
		try {
			result = await loginWithProvider(provider, ticket);
		} catch (error) {
			// The ticket stays good for the code.
			if (error instanceof TwoFactorRequiredError) {
				setCode('');
				setCodeFor({ kind: 'provider', provider, ticket });
				return;
			}
			throw error;
		}
		if (result === 'not-linked') {
			onSwitchToRegister({ provider, ticket });
			return;
		}
		signedIn();
	};

	const handleShowPrivacy = () => {
		setShowPrivacy(true);
	};

	const handleClosePrivacy = () => {
		setShowPrivacy(false);
	};

	const handleGuestSession = async () => {
		setError(null);
		setIsLoading(true);

		try {
			moduleLog.info('Starting guest session creation...');
			const guestUser = await createGuestAccount();
			moduleLog.info('Guest session created successfully:', guestUser.id);
			setShowGuestModal(false);
			onLoginSuccess();
		} catch (error) {
			moduleLog.error('Guest session creation failed:', error);
			setError(
				error instanceof Error
					? error.message
					: t('Failed to create guest session'),
			);
		} finally {
			setIsLoading(false);
		}
	};

	if (recovering) {
		return (
			<RecoverAccount
				initialUsername={username}
				onRecovered={() => {
					onLoginSuccess();
					window.location.reload();
				}}
				onCancel={() => setRecovering(false)}
			/>
		);
	}

	if (codeFor) {
		return (
			<div className='auth-form-container' data-role='two-factor-step'>
				<h2>{t('Two-factor authentication')}</h2>
				{error && (
					<div className='ui-message' data-tone='error'>
						{error}
					</div>
				)}
				<form onSubmit={submitCode} className='ui-stack'>
					<p>
						{t(
							'Enter the code that your authenticator app shows for Feuillet. Without your phone, one of your recovery codes works too, once.',
						)}
					</p>
					<div className='ui-field' data-spacing='section'>
						<label htmlFor='two-factor-code'>{t('Code')}</label>
						<input
							type='text'
							id='two-factor-code'
							value={code}
							onChange={(e) => setCode(e.target.value)}
							disabled={isLoading}
							autoComplete='one-time-code'
							autoCapitalize='off'
							spellCheck={false}
							// biome-ignore lint/a11y/noAutofocus: the only field of this step
							autoFocus
						/>
					</div>
					<button
						type='submit'
						className='button primary'
						data-state={isLoading ? 'loading' : undefined}
						disabled={isLoading || !code.trim()}
					>
						{isLoading ? t('Logging in...') : t('Log in')}
					</button>
					<button
						type='button'
						className='button'
						data-variant='text'
						data-action='two-factor-back'
						onClick={() => {
							setCodeFor(null);
							setError(null);
						}}
						disabled={isLoading}
					>
						{t('Back')}
					</button>
				</form>
			</div>
		);
	}

	return (
		<>
			<div className='auth-form-container'>
				<h2>{t('Log in')}</h2>

				{error && (
					<div className='ui-message' data-tone='error'>
						{error}
					</div>
				)}

				<form onSubmit={handleSubmit} className='ui-stack'>
					<div className='ui-field' data-spacing='section'>
						<label htmlFor='username'>{t('Username')}</label>
						<input
							type='text'
							id='username'
							value={username}
							onChange={(e) => {
								setUsername(e.target.value);
								setConfirmCreate(false);
							}}
							disabled={isLoading}
							autoComplete='username'
						/>
					</div>

					<div className='ui-field' data-spacing='section'>
						<label htmlFor='password'>{t('Password')}</label>
						<input
							type='password'
							id='password'
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							disabled={isLoading}
							autoComplete='current-password'
						/>
						<button
							type='button'
							className='button'
							data-variant='text'
							data-action='forgot-password'
							onClick={() => {
								setError(null);
								setRecovering(true);
							}}
							disabled={isLoading}
						>
							{t('Forgot your password?')}
						</button>
					</div>

					<button
						type='submit'
						className='button primary'
						data-state={isLoading ? 'loading' : undefined}
						disabled={isLoading}
						hidden={getTempPrf() !== null}
					>
						{isLoading ? t('Logging in...') : t('Log in')}
					</button>

					{!CHELYS_ACCOUNTS_ENABLED ? null : !confirmCreate ? (
						<button
							type='button'
							className='button'
							data-tone='accent'
							data-state={isLoading ? 'loading' : undefined}
							onClick={handleChelysSubmit}
							disabled={isLoading}
						>
							<span>{t('Log in to Chelys')}</span>
							<span
								className='ui-badge'
								data-variant='label'
								data-tone='accent'
							>
								{getTempPrf() ? (
									<>{t('Temporary')} </>
								) : (
									<>
										<PasskeyIcon size={24} />
										{t('Passkey')}
									</>
								)}
							</span>
						</button>
					) : (
						<div className='chelys-confirm'>
							<p>
								{t(
									'No "{username}" account in this browser yet. Check the spelling, or create it here.',
									{ username },
								)}
							</p>
							<div
								className='ui-actions'
								data-variant='modal'
								data-align='end'
								data-cross='stretch'
							>
								<button
									type='button'
									className='button secondary'
									onClick={() => setConfirmCreate(false)}
									disabled={isLoading}
								>
									{t('Back')}
								</button>
								<button
									type='button'
									className='button primary'
									onClick={handleConfirmCreate}
									disabled={isLoading}
								>
									{t('Create account')}
								</button>
							</div>
						</div>
					)}
				</form>
				{!getTempPrf() && (
					<>
						<div className='guest-section'>
							<div className='guest-divider'>
								<span>{t('or')}</span>
							</div>
							{SIGN_IN_PROVIDERS.map((provider) => (
								<ExternalSignInButton
									key={provider}
									provider={provider}
									label={t('Sign in with {provider}', {
										provider: PROVIDER_NAMES[provider],
									})}
									disabled={isLoading}
									onStart={() => setError(null)}
									onTicket={(ticket) => handleProviderTicket(provider, ticket)}
									onError={setError}
								/>
							))}
							<button
								type='button'
								className='button'
								data-width='full'
								onClick={() => setShowGuestModal(true)}
								disabled={isLoading}
							>
								{t('Try as Guest')}
							</button>
						</div>

						<div className='ui-actions' data-align='center' data-wrap='true'>
							<span>{t("Don't have an account?")}</span>
							<button
								type='button'
								className='button'
								data-variant='text'
								onClick={() => onSwitchToRegister()}
								disabled={isLoading}
							>
								{t('Sign up')}
							</button>
							<span className='auth-separator'>{t('or')}</span>
							<button
								type='button'
								className='button'
								data-variant='text'
								data-role='auth-import-account'
								onClick={onSwitchToImport}
								disabled={isLoading}
							>
								{t('Import Account')}
							</button>
						</div>
					</>
				)}
			</div>

			<GuestConsentModal
				isOpen={showGuestModal}
				onClose={() => setShowGuestModal(false)}
				onStartGuestSession={handleGuestSession}
				onSwitchToRegister={() => {
					setShowGuestModal(false);
					onSwitchToRegister();
				}}
				onShowPrivacy={handleShowPrivacy}
				isPrivacyOpen={showPrivacy}
			/>

			<PrivacyModal isOpen={showPrivacy} onClose={handleClosePrivacy} />
		</>
	);
};

export default Login;
