// src/components/auth/GoogleSignInButton.tsx
// « Se connecter avec Google », as on Overleaf, when the collaboration server
// offers it: the button opens Google's window, then hands the ticket it gave
// to `onTicket`. While the window is open, it says so and may be cancelled
// (whether it was closed cannot be told once it went to Google).
import type React from 'react';
import { useEffect, useState } from 'react';

import { t } from '@/i18n';
import { accountSyncService } from '../../services/AccountSyncService';
import {
	type GoogleSignIn,
	googleSignInService,
} from '../../services/GoogleSignInService';
import { GoogleIcon } from '../common/Icons';

interface GoogleSignInButtonProps {
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
	/** Shown after it, only when it is: « ou » before a form. */
	after?: React.ReactNode;
}

const GoogleSignInButton: React.FC<GoogleSignInButtonProps> = ({
	label,
	disabled = false,
	onTicket,
	onError,
	onStart,
	canStart,
	variant = 'full',
	after = null,
}) => {
	const [available, setAvailable] = useState(false);
	const [signIn, setSignIn] = useState<GoogleSignIn | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let current = true;
		void googleSignInService
			.isAvailable(accountSyncService.serverFor())
			.then((enabled) => {
				if (current) setAvailable(enabled);
			});
		return () => {
			current = false;
		};
	}, []);

	if (!available) return null;

	const start = async () => {
		if (canStart && !canStart()) return;
		onStart?.();
		const attempt = googleSignInService.signIn(accountSyncService.serverFor());
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
			<>
				<div
					className='ui-actions google-sign-in-waiting'
					data-align='center'
					data-wrap='true'
					data-role='google-sign-in-waiting'
				>
					<span className='ui-meta'>
						{t('Finish signing in in the Google window.')}
					</span>
					<button
						type='button'
						className='button secondary'
						data-action='cancel-google-sign-in'
						onClick={signIn.cancel}
					>
						{t('Cancel')}
					</button>
				</div>
				{after}
			</>
		);
	}

	return (
		<>
			<button
				type='button'
				className='button google-sign-in'
				data-width={variant === 'full' ? 'full' : undefined}
				data-action='google-sign-in'
				data-state={busy ? 'loading' : undefined}
				disabled={disabled || busy}
				onClick={() => void start()}
			>
				<GoogleIcon />
				<span>{busy ? t('Signing in with Google…') : label}</span>
			</button>
			{after}
		</>
	);
};

export default GoogleSignInButton;
