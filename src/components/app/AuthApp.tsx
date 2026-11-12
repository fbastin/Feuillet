// src/components/app/AuthApp.tsx
import type React from 'react';
import { useState } from 'react';

import { t } from '@/i18n';
import texlyreLogo from '../../assets/images/TeXlyre_notext.png';
import { useTheme } from '../../hooks/useTheme';
import {
	inviteOf,
	pushHash,
	replaceHash,
	signUpOf,
} from '../../utils/urlUtils';
import ImportAccount from '../auth/ImportAccount';
import Login from '../auth/Login';
import Register from '../auth/Register';
import ResetPassword from '../auth/ResetPassword';
import type { ProviderTicket } from '../../services/ExternalSignInService';
import PrivacyModal from '../common/PrivacyModal';
import ThemeToggleButton from '../settings/ThemeToggleButton';
import LanguageToggleButton from '../settings/LanguageToggleButton';
import FooterLinks from '../common/FooterLinks';

interface AuthContainerProps {
	onAuthSuccess: () => void;
	/** A mailed link's token, to choose a new password. */
	resetToken?: string | null;
	onResetClose?: () => void;
}

const AuthApp: React.FC<AuthContainerProps> = ({
	onAuthSuccess,
	resetToken,
	onResetClose,
}) => {
	const { currentThemePlugin, currentVariant } = useTheme();
	// A link to create an account opens on the form that does.
	const [activeView, setActiveView] = useState<'login' | 'register' | 'import'>(
		() => (signUpOf(window.location.hash) ? 'register' : 'login'),
	);
	const [showPrivacy, setShowPrivacy] = useState(false);
	// Google's or ORCID's sign-in for an account of theirs linked to no
	// account yet: the account created next is linked to it.
	const [link, setLink] = useState<ProviderTicket | null>(null);

	const switchToLogin = () => {
		setLink(null);
		setActiveView('login');
	};

	const switchToRegister = (ticket?: ProviderTicket) => {
		setLink(ticket ?? null);
		setActiveView('register');
	};

	const switchToImport = () => {
		setActiveView('import');
	};

	return (
		<div className={`auth-container ${currentThemePlugin?.id || 'default'}`}>
			<div
				className='auth-box ui-card'
				data-surface='secondary'
				data-radius='lg'
			>
				<div className='auth-header'>
					<div className='auth-logo-wrapper'>
						<img
							src={texlyreLogo}
							className='auth-logo'
							alt={t('TeXlyre logo')}
						/>
					</div>
					<h1>{t('TeXlyre')}</h1>
					<div className='auth-header-controls ui-actions'>
						<LanguageToggleButton className='auth-language-toggle' />
						<ThemeToggleButton className='auth-theme-toggle' />
					</div>
				</div>

				{signUpOf(window.location.hash) && (
					<div
						className='ui-message'
						data-tone='info'
						data-role='sign-up-link-notice'
					>
						{t(
							'This link creates an account on this server: choose a name and a password.',
						)}
					</div>
				)}

				{inviteOf(window.location.hash) && (
					<div
						className='ui-message'
						data-tone='info'
						data-role='invite-notice'
					>
						{t(
							'You were invited to work on a project. Sign in, or create an account, to join it.',
						)}
					</div>
				)}

				{resetToken ? (
					<ResetPassword
						token={resetToken}
						onDone={() => {
							replaceHash('');
							window.location.reload();
						}}
						onCancel={() => onResetClose?.()}
					/>
				) : activeView === 'login' ? (
					<Login
						onLoginSuccess={onAuthSuccess}
						onSwitchToRegister={switchToRegister}
						onSwitchToImport={switchToImport}
					/>
				) : activeView === 'register' ? (
					<Register
						onRegisterSuccess={onAuthSuccess}
						onSwitchToLogin={switchToLogin}
						onShowPrivacy={() => setShowPrivacy(true)}
						link={link}
						onLink={setLink}
					/>
				) : (
					<ImportAccount
						onImportSuccess={onAuthSuccess}
						onSwitchToLogin={switchToLogin}
					/>
				)}

				<div
					className='ui-message'
					data-tone='info'
					data-density='compact'
					data-align='center'
				>
					{/* TeXlyre kept everything in the browser; Feuillet keeps the
					    projects on its server too. */}
					<p data-role='auth-privacy'>
						{t(
							'Your projects are kept in this browser and on the Feuillet server, for your other devices and your collaborators; no tracking, no advertising.',
						)}
						&nbsp;
						<button
							type='button'
							className='button'
							data-variant='text'
							onClick={() => {
								pushHash('privacy-policy');
								setShowPrivacy(true);
							}}
						>
							{t('What the server keeps')}
						</button>
					</p>
				</div>
			</div>
			<footer>
				<FooterLinks
					onShowPrivacy={() => {
						pushHash('privacy-policy');
						setShowPrivacy(true);
					}}
				/>
			</footer>

			<PrivacyModal
				isOpen={showPrivacy}
				onClose={() => {
					setShowPrivacy(false);
					if (window.location.hash === '#privacy-policy') {
						history.back();
					}
				}}
			/>
		</div>
	);
};

export default AuthApp;
