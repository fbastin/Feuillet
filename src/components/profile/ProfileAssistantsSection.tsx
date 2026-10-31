// src/components/profile/ProfileAssistantsSection.tsx
// Claude and other assistants working on the account's projects through the
// server's connector (server/collab/mcp.js): where to add it in Claude and
// in Claude Code, and the applications connected, which one may disconnect.
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';

import { t } from '@/i18n';
import { useAuth } from '../../hooks/useAuth';
import {
	type AccountSyncStatus,
	type AssistantConnection,
	accountSyncService,
} from '../../services/AccountSyncService';
import CopyField from '../common/CopyField';
import ServerAccountLinkForm from './ServerAccountLinkForm';

const dateOf = (time: number) =>
	new Date(time).toLocaleDateString(undefined, {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
	});

const ProfileAssistantsSection: React.FC = () => {
	const { user, isGuestUser } = useAuth();
	const [status, setStatus] = useState<AccountSyncStatus>(
		accountSyncService.getStatus(),
	);
	const [connections, setConnections] = useState<AssistantConnection[] | null>(
		null,
	);
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => accountSyncService.addListener(setStatus), []);

	const connectorUrl =
		status.state === 'signed-out'
			? null
			: accountSyncService.assistantConnectorUrl();

	const load = useCallback(async (revoke?: string) => {
		setError(null);
		try {
			setConnections(await accountSyncService.assistantConnections(revoke));
		} catch {
			setError(t('The server could not be reached. Please try again later.'));
		}
	}, []);

	useEffect(() => {
		if (connectorUrl) void load();
	}, [connectorUrl, load]);

	if (!user || isGuestUser(user)) return null;

	const disconnect = async (connection: AssistantConnection) => {
		setBusy(connection.id);
		try {
			await load(connection.id);
		} finally {
			setBusy(null);
		}
	};

	return (
		<div className='ui-stack assistants-section' data-gap='sm'>
			<h3>{t('Claude and other assistants')}</h3>
			<p>
				{t(
					'Claude can work on your projects: read and search them, compile them, suggest changes and comment, as far as your role in each project allows. Its changes arrive as tracked changes, which you accept or reject.',
				)}
			</p>

			{!connectorUrl ? (
				<ServerAccountLinkForm
					reason={t('Assistants work on the projects kept on the server.')}
					onLinked={() => setStatus(accountSyncService.getStatus())}
				/>
			) : (
				<>
					<h4>{t('In Claude (web or desktop app)')}</h4>
					<p className='ui-meta'>
						{t(
							'In Claude, open Settings, then Connectors, choose "Add custom connector" and paste this address. Claude then asks you to sign in with your Feuillet username and password.',
						)}
					</p>
					<CopyField id='assistant-connector-url' value={connectorUrl} mono />

					<h4>{t('In Claude Code')}</h4>
					<p className='ui-meta'>
						{t(
							'In a terminal, run this command, then type /mcp in Claude Code to sign in:',
						)}
					</p>
					<CopyField
						id='assistant-claude-code-command'
						value={`claude mcp add --transport http feuillet ${connectorUrl}`}
						mono
					/>
					<p className='ui-meta'>
						{t(
							'To have Claude Code work on a copy on your computer instead, link the project to a GitHub repository, clone it, and push its changes; then pull them in Feuillet.',
						)}
					</p>

					<h4>{t('Connected applications')}</h4>
					{error && (
						<div className='ui-message' data-tone='warning'>
							{error}
						</div>
					)}
					{connections && connections.length === 0 && (
						<p className='ui-meta'>{t('No application is connected.')}</p>
					)}
					{connections && connections.length > 0 && (
						<ul
							className='assistant-connections'
							data-role='assistant-connections'
						>
							{connections.map((connection) => (
								<li key={connection.id} data-connection={connection.name}>
									<div>
										<strong>{connection.name}</strong>
										<span className='ui-meta'>
											{t('Connected on {date}, last used on {used}', {
												date: dateOf(connection.createdAt),
												used: dateOf(connection.lastUsedAt),
											})}
										</span>
									</div>
									<button
										type='button'
										className='button secondary'
										data-action='disconnect-assistant'
										disabled={busy !== null}
										aria-busy={busy === connection.id}
										onClick={() => void disconnect(connection)}
									>
										{t('Disconnect')}
									</button>
								</li>
							))}
						</ul>
					)}
				</>
			)}
		</div>
	);
};

export default ProfileAssistantsSection;
