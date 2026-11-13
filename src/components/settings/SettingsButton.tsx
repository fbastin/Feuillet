// src/components/settings/SettingsButton.tsx
import type React from 'react';
import { useEffect, useState } from 'react';

import { t } from '@/i18n';
import { SettingsIcon } from '../common/Icons';
import { OPEN_SETTINGS } from '../../utils/workspaceEvents';
import SettingsModal from './SettingsModal';

interface SettingsButtonProps {
	className?: string;
}

const SettingsButton: React.FC<SettingsButtonProps> = ({ className = '' }) => {
	const [isSettingsOpen, setIsSettingsOpen] = useState(false);

	// Asked from elsewhere (the command palette).
	useEffect(() => {
		const open = () => setIsSettingsOpen(true);
		document.addEventListener(OPEN_SETTINGS, open);
		return () => document.removeEventListener(OPEN_SETTINGS, open);
	}, []);

	return (
		<>
			<button
				type='button'
				className={`button ${className}`}
				onClick={() => setIsSettingsOpen(true)}
				title={t('Settings')}
			>
				<SettingsIcon />
			</button>
			<SettingsModal
				isOpen={isSettingsOpen}
				onClose={() => setIsSettingsOpen(false)}
			/>
		</>
	);
};

export default SettingsButton;
