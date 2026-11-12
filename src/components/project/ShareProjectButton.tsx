// src/components/project/ShareProjectButton.tsx
// The header's Share button, named as on Overleaf, where its icon alone was
// easy to miss among the others; with, for the owner, the count of access
// requests waiting, as Overleaf's badge.
import type React from 'react';

import { t } from '@/i18n';
import { ShareIcon } from '../common/Icons';

interface ShareProjectButtonProps {
	className?: string;
	onOpenShareModal: () => void;
	/** Access requests waiting for the owner. */
	requests?: number;
}

const ShareProjectButton: React.FC<ShareProjectButtonProps> = ({
	className = '',
	onOpenShareModal,
	requests = 0,
}) => (
	<div className={`ui-control-cluster ${className}`}>
		<button
			type='button'
			className='button share-button'
			data-role='share'
			onClick={onOpenShareModal}
			title={
				requests > 0
					? t('Access requests to decide: {number}', { number: requests })
					: t('Share Project')
			}
		>
			<ShareIcon />
			<span>{t('Share')}</span>
			{requests > 0 && (
				<span className='share-button-requests' data-role='share-requests'>
					{requests}
				</span>
			)}
		</button>
	</div>
);

export default ShareProjectButton;
