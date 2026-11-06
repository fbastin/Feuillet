// src/components/auth/PasswordInfo.tsx
import type React from 'react';

import { t } from '@/i18n';
import InfoTooltip from '../common/InfoTooltip';

// Under the password field: what the password does on Feuillet, where
// accounts live on the server (TeXlyre's note spoke of the browser only).
const PasswordInfo: React.FC = () => {
	return (
		<div className='ui-toolbar ui-field-hint' data-gap='xs'>
			<span className='ui-note'>
				{t(
					'It signs you in to your Feuillet account, on any device, and encrypts your tokens in this browser.',
				)}
			</span>
			<InfoTooltip
				content={t(
					"Your password signs you in to your Feuillet account on any device; the server keeps only a hash of it. In this browser, it also encrypts sensitive information such as GitHub tokens and API keys. Your projects remain readable in this browser's storage: on a shared computer, sign out and clear Feuillet's browser data before leaving.",
				)}
			/>
		</div>
	);
};

export default PasswordInfo;
