// src/components/profile/AdminSignUps.tsx
// The administration page's sign-ups: who may create an account on the
// server (SIGN_UP in /etc/feuillet/collab.env, server/collab/accounts.js)
// and, where that takes an invitation, links to create one, as an Overleaf
// Server's administrator creates its users. A link makes one account within
// 7 days; it shows once, when made, and may be taken back.
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';

import { t } from '@/i18n';
import {
	type AdminSignUpLinks,
	accountSyncService,
} from '../../services/AccountSyncService';
import { signUpUrl } from '../../utils/urlUtils';
import CopyField from '../common/CopyField';

interface AdminSignUpsProps {
	dayOf: (time: number) => string;
}

const AdminSignUps: React.FC<AdminSignUpsProps> = ({ dayOf }) => {
	const [state, setState] = useState<AdminSignUpLinks | null>(null);
	const [made, setMade] = useState<{ url: string; expiresAt: number } | null>(
		null,
	);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		try {
			setState(await accountSyncService.adminSignUpLinks());
		} catch {
			setState(null);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const change = async (revoke?: string) => {
		setBusy(true);
		setError(null);
		try {
			const result = await accountSyncService.adminChangeSignUpLinks(revoke);
			setState((current) =>
				current ? { ...current, links: result.links } : current,
			);
			if (result.token && result.expiresAt) {
				setMade({ url: signUpUrl(result.token), expiresAt: result.expiresAt });
			}
		} catch {
			setError(
				revoke
					? t('The link could not be taken back. Please try again later.')
					: t('The link could not be made. Please try again later.'),
			);
		} finally {
			setBusy(false);
		}
	};

	if (!state) return null;

	return (
		<section className='ui-stack' data-gap='sm' data-role='admin-sign-ups'>
			<div className='ui-toolbar admin-toolbar' data-justify='between'>
				<h3>{t('Creating accounts')}</h3>
				{state.mode === 'invitation' && (
					<button
						type='button'
						className='button'
						data-action='make-sign-up-link'
						onClick={() => void change()}
						disabled={busy}
					>
						{t('New link to create an account')}
					</button>
				)}
			</div>
			<p data-role='admin-sign-up-mode'>
				{state.mode === 'invitation'
					? state.domains.length > 0
						? t(
								'By invitation: to a project, by a link below, or with an address at {domains}, confirmed by a link mailed to it.',
								{ domains: state.domains.join(', ') },
							)
						: t('By invitation: to a project, or by a link below.')
					: t(
							'Anyone may create an account. SIGN_UP=invitation, in /etc/feuillet/collab.env, keeps that to invitations (deploy/README.md).',
						)}
			</p>
			{error && (
				<div className='ui-message' data-tone='error'>
					{error}
				</div>
			)}
			{made && (
				<div
					className='ui-message'
					data-tone='success'
					data-role='admin-sign-up-made'
				>
					<p>
						{t(
							'Send this link to the person who will create the account: it makes one, until {date}. It is shown only now.',
							{ date: dayOf(made.expiresAt) },
						)}
					</p>
					<CopyField value={made.url} mono />
				</div>
			)}
			{state.links.length > 0 && (
				<table className='admin-accounts' data-role='admin-sign-up-links'>
					<thead>
						<tr>
							<th>{t('Made')}</th>
							<th>{t('By')}</th>
							<th>{t('Until')}</th>
							<th />
						</tr>
					</thead>
					<tbody>
						{state.links.map((link) => (
							<tr key={link.id}>
								<td>{dayOf(link.createdAt)}</td>
								<td>{link.mailed ? t('Mailed on request') : link.by || '—'}</td>
								<td>{dayOf(link.expiresAt)}</td>
								<td>
									<button
										type='button'
										className='button'
										data-variant='text'
										data-action='revoke-sign-up-link'
										onClick={() => void change(link.id)}
										disabled={busy}
									>
										{t('Take back')}
									</button>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
		</section>
	);
};

export default AdminSignUps;
