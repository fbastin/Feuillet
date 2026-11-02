// src/components/app/AuthApp.tsx
import type React from 'react';
import { useState } from 'react';

import { t } from '@/i18n';
import texlyreLogo from '../../assets/images/TeXlyre_notext.png';
import { useTheme } from '../../hooks/useTheme';
import { inviteOf, pushHash } from '../../utils/urlUtils';
import ImportAccount from '../auth/ImportAccount';
import Login from '../auth/Login';
import Register from '../auth/Register';
import PrivacyModal from '../common/PrivacyModal';
import ThemeToggleButton from '../settings/ThemeToggleButton';
import LanguageToggleButton from '../settings/LanguageToggleButton';
import FooterLinks from '../common/FooterLinks';

interface AuthContainerProps {
	onAuthSuccess: () => void;
}

const AuthApp: React.FC<AuthContainerProps> = ({ onAuthSuccess }) => {
	const { currentThemePlugin, currentVariant } = useTheme();
	const [activeView, setActiveView] = useState<'login' | 'register' | 'import'>(
		'login',
	);
	const [showPrivacy, setShowPrivacy] = useState(false);

	const switchToLogin = () => {
		setActiveView('login');
	};

	const switchToRegister = () => {
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

				{activeView === 'login' ? (
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
