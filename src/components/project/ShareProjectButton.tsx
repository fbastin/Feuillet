// src/components/project/ShareProjectButton.tsx
// The header's Share button, named as on Overleaf, where its icon alone was
// easy to miss among the others.
import type React from 'react';

import { t } from '@/i18n';
import { ShareIcon } from '../common/Icons';

interface ShareProjectButtonProps {
	className?: string;
	onOpenShareModal: () => void;
}

const ShareProjectButton: React.FC<ShareProjectButtonProps> = ({
	className = '',
	onOpenShareModal,
}) => (
	<div className={`ui-control-cluster ${className}`}>
		<button
			type='button'
			className='button share-button'
			data-role='share'
			onClick={onOpenShareModal}
			title={t('Share Project')}
		>
			<ShareIcon />
			<span>{t('Share')}</span>
		</button>
	</div>
);

export default ShareProjectButton;
