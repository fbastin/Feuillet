// src/components/auth/ExternalSignInButton.tsx
// « Se connecter avec Google » or « … avec ORCID », as on Overleaf, when the
// collaboration server offers it: the button opens the site's window, then
// hands the ticket it gave to `onTicket`. While the window is open, it says
// so and may be cancelled (whether it was closed cannot be told once it went
// to the site).
import type React from 'react';
import { useEffect, useState } from 'react';

import { t } from '@/i18n';
import { accountSyncService } from '../../services/AccountSyncService';
import {
	type ExternalSignIn,
	PROVIDER_NAMES,
	SIGN_IN_PROVIDERS,
	type SignInProvider,
	signInServices,
} from '../../services/ExternalSignInService';
import { GoogleIcon, OrcidIcon } from '../common/Icons';

interface ExternalSignInButtonProps {
	provider: SignInProvider;
	label: string;
	disabled?: boolean;
	onTicket: (ticket: string) => Promise<void>;
	onError: (message: string) => void;
	/** Before the window opens, as clearing an earlier error. */
	onStart?: () => void;
	/** Whether the window may open now, as when a password is missing. */
	canStart?: () => boolean;
	/** The button's look: as a sign-in page's (full) or a form's. */
	variant?: 'full' | 'inline';
}

/** The sites the collaboration server signs in with, once it says. */
export const useAvailableProviders = (): SignInProvider[] => {
	const [available, setAvailable] = useState<SignInProvider[]>([]);
	useEffect(() => {
		let current = true;
		const server = accountSyncService.serverFor();
		void Promise.all(
			SIGN_IN_PROVIDERS.map((provider) =>
				signInServices[provider].isAvailable(server),
			),
		).then((answers) => {
			if (current) {
				setAvailable(SIGN_IN_PROVIDERS.filter((_, index) => answers[index]));
			}
		});
		return () => {
			current = false;
		};
	}, []);
	return available;
};

const ExternalSignInButton: React.FC<ExternalSignInButtonProps> = ({
	provider,
	label,
	disabled = false,
	onTicket,
	onError,
	onStart,
	canStart,
	variant = 'full',
}) => {
	const [available, setAvailable] = useState(false);
	const [signIn, setSignIn] = useState<ExternalSignIn | null>(null);
	const [busy, setBusy] = useState(false);
	const service = signInServices[provider];
	const name = PROVIDER_NAMES[provider];

	useEffect(() => {
		let current = true;
		void service.isAvailable(accountSyncService.serverFor()).then((enabled) => {
			if (current) setAvailable(enabled);
		});
		return () => {
			current = false;
		};
	}, [service]);

	if (!available) return null;

	const start = async () => {
		if (canStart && !canStart()) return;
		onStart?.();
		const attempt = service.signIn(accountSyncService.serverFor());
		setSignIn(attempt);
		try {
			const ticket = await attempt.ticket;
			setSignIn(null);
			setBusy(true);
			await onTicket(ticket);
		} catch (error) {
			onError(error instanceof Error ? error.message : String(error));
		} finally {
			setSignIn(null);
			setBusy(false);
		}
	};

	if (signIn) {
		return (
			<div
				className='ui-actions external-sign-in-waiting'
				data-align='center'
				data-wrap='true'
				data-role={`${provider}-sign-in-waiting`}
			>
				<span className='ui-meta'>
					{t('Finish signing in in the {provider} window.', {
						provider: name,
					})}
				</span>
				<button
					type='button'
					className='button secondary'
					data-action={`cancel-${provider}-sign-in`}
					onClick={signIn.cancel}
				>
					{t('Cancel')}
				</button>
			</div>
		);
	}

	return (
		<button
			type='button'
			className='button external-sign-in'
			data-width={variant === 'full' ? 'full' : undefined}
			data-action={`${provider}-sign-in`}
			data-state={busy ? 'loading' : undefined}
			disabled={disabled || busy}
			onClick={() => void start()}
		>
			{provider === 'google' ? <GoogleIcon /> : <OrcidIcon />}
			<span>
				{busy ? t('Signing in with {provider}…', { provider: name }) : label}
			</span>
		</button>
	);
};

export default ExternalSignInButton;
