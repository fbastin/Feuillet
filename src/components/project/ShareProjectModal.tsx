// src/components/project/ShareProjectModal.tsx
import QRCode from 'qrcode';
import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { t } from '@/i18n';
import { useCollab } from '../../hooks/useCollab';
import { useLSPConfig } from '../../hooks/useLSPConfig';
import { useProjectLink } from '../../hooks/useProjectLink';
import { useSettings } from '../../hooks/useSettings';
import { useSharedToolPreferences } from '../../hooks/useSharedToolPreferences';
import { useTypesetterConfig } from '../../hooks/useTypesetterConfig';
import {
	AccountServerError,
	accountSyncService,
	type ProjectAccess,
} from '../../services/AccountSyncService';
import { requestReadOnlyProjectId } from '../../services/ReadOnlyLinkService';
import { typesetterRegistryService } from '../../services/TypesetterRegistryService';
import type { DocumentList } from '../../types/documents';
import type { SharedLocalTool, SharedToolKind } from '../../types/sharedTools';
import type { ToolConfigBlock } from '../../types/toolConfig';
import { collabHttpBaseUrl } from '../../utils/serverFileSyncUtils';
import {
	describeSharedToolAvailability,
	projectSharingKey,
} from '../../utils/sharedToolsUtils';
import { ShareIcon } from '../common/Icons';
import CopyField from '../common/CopyField';
import Modal from '../common/Modal';
import ProjectMembersSection from './ProjectMembersSection';

interface ShareProjectModalProps {
	isOpen: boolean;
	onClose: () => void;
	projectName: string;
	shareUrl: string;
	docUrl: string;
}

const ShareProjectModal: React.FC<ShareProjectModalProps> = ({
	isOpen,
	onClose,
	projectName,
	shareUrl,
	docUrl,
}) => {
	const [qrCodeUrl, setQrCodeUrl] = useState<string>('');
	const { data: doc, readOnly, reviewOnly } = useCollab<DocumentList>();
	const { getSetting } = useSettings();
	// Projects synced through the collaboration server have links it manages.
	const serverLinks =
		getSetting('collab-provider-type')?.value === 'websocket' && !readOnly;
	const websocketServer =
		(getSetting('collab-websocket-server')?.value as string | undefined) ?? '';
	const projectId = docUrl.startsWith('yjs:') ? docUrl.slice(4) : docUrl;
	const { serverId } = useProjectLink(projectId);
	const linkBase = `${window.location.origin}${window.location.pathname}`;
	// Its editing link changes when its owner replaces it.
	const projectUrl = readOnly ? shareUrl : `${linkBase}#yjs:${serverId}`;
	const [readOnlyId, setReadOnlyId] = useState<string | null>(null);
	const [readOnlyError, setReadOnlyError] = useState<string | null>(null);
	const [confirmReplace, setConfirmReplace] = useState(false);
	const readOnlyUrl = readOnlyId ? `${linkBase}#yjs:${readOnlyId}` : '';
	// undefined while unknown; null when no account is signed in.
	const [access, setAccess] = useState<ProjectAccess | null | undefined>();
	const [accessError, setAccessError] = useState<string | null>(null);
	const [confirmEditReplace, setConfirmEditReplace] = useState(false);
	const [accessBusy, setAccessBusy] = useState(false);

	const loadReadOnlyLink = useCallback(
		async (reset: boolean) => {
			setReadOnlyError(null);
			try {
				setReadOnlyId(
					await requestReadOnlyProjectId(
						collabHttpBaseUrl(websocketServer),
						serverId,
						reset,
					),
				);
			} catch (error) {
				setReadOnlyError(
					error instanceof Error ? error.message : String(error),
				);
			}
		},
		[serverId, websocketServer],
	);

	const changeAccess = useCallback(
		async (options: { claim?: boolean; reset?: boolean }) => {
			setAccessError(null);
			setAccessBusy(true);
			try {
				setAccess(await accountSyncService.projectAccess(projectId, options));
			} catch (error) {
				const code = error instanceof AccountServerError ? error.code : '';
				setAccessError(
					code === 'link_replaced'
						? t(
								'This link no longer opens the project: it was replaced. Ask whoever shared it for the new link. You see the last version received.',
							)
						: code === 'unreachable'
							? t('Could not reach the collaboration server.')
							: t('Could not manage the editing link.'),
				);
			} finally {
				setAccessBusy(false);
			}
		},
		[projectId],
	);

	useEffect(() => {
		if (isOpen && serverLinks) void loadReadOnlyLink(false);
		if (!isOpen) setConfirmReplace(false);
	}, [isOpen, serverLinks, loadReadOnlyLink]);

	useEffect(() => {
		if (isOpen && serverLinks) void changeAccess({});
		if (!isOpen) {
			setConfirmEditReplace(false);
			setAccess(undefined);
		}
	}, [isOpen, serverLinks, changeAccess]);
	const typesetters = useTypesetterConfig();
	const lsps = useLSPConfig();
	const preferences = useSharedToolPreferences();
	const projectKey = projectSharingKey(shareUrl);
	const projectShareEnabled = preferences.isShareProjectTools(projectKey);

	const projectTools = useMemo(() => {
		const projectType = doc?.projectMetadata?.type ?? 'latex';
		const compilerId = doc?.projectMetadata?.compilerId;
		const provider = typesetterRegistryService.resolve(projectType, compilerId);
		const usedTypesetterId = provider?.source === 'chelys' ? provider.id : null;
		const usedLspIds = new Set(
			(doc?.documents ?? []).flatMap((document) =>
				lsps.getConfigsForFile(document.name).map((config) => config.id),
			),
		);

		const makeTool = (
			kind: SharedToolKind,
			config: ToolConfigBlock,
			usedByProject: boolean,
		): SharedLocalTool => {
			const share = describeSharedToolAvailability(config);
			return {
				kind,
				config,
				shareable: share.shareable,
				shareMessage: share.message,
				sharedWithAll: preferences.isSharedWithAll(kind, config.id),
				usedByProject,
			};
		};

		return [
			...typesetters.configs
				.filter((config) => config.enabled)
				.map((config) =>
					makeTool('typesetter', config, config.id === usedTypesetterId),
				),
			...lsps.configs
				.filter((config) => config.enabled)
				.map((config) => makeTool('lsp', config, usedLspIds.has(config.id))),
		];
	}, [
		doc?.documents,
		doc?.projectMetadata?.compilerId,
		doc?.projectMetadata?.type,
		typesetters.configs,
		lsps.configs,
		lsps.getConfigsForFile,
		preferences.isSharedWithAll,
	]);

	const globallySharedTools = projectTools.filter(
		(tool) => tool.sharedWithAll && tool.shareable,
	);
	const projectUsedTools = projectTools.filter((tool) => tool.usedByProject);
	const projectAdditionalTools = projectUsedTools.filter(
		(tool) => !tool.sharedWithAll,
	);
	const shareableProjectTools = projectAdditionalTools.filter(
		(tool) => tool.shareable,
	);
	const unavailableProjectTools = projectAdditionalTools.filter(
		(tool) => !tool.shareable,
	);
	const hasProjectTools = projectUsedTools.length > 0;

	useEffect(() => {
		if (isOpen && projectUrl) {
			QRCode.toDataURL(projectUrl, {
				width: 200,
				margin: 2,
				color: {
					dark: '#000000',
					light: '#ffffff',
				},
			})
				.then(setQrCodeUrl)
				.catch(console.error);
		}
	}, [isOpen, projectUrl]);

	return (
		<Modal
			isOpen={isOpen}
			onClose={onClose}
			title={t('Share Project')}
			icon={ShareIcon}
			size='medium'
		>
			<div className='ui-stack share-project' data-gap='lg'>
				<h4 className='ui-panel-title' data-size='body'>
					{t('Share "')}
					{projectName}"
				</h4>

				{serverLinks && access?.owner === 'you' && (
					<ProjectMembersSection
						projectId={projectId}
						projectName={projectName}
						projectType={doc?.projectMetadata?.type ?? 'latex'}
					/>
				)}

				{/* As on Overleaf's link sharing: a link to edit, one to read. */}
				<section className='ui-stack' data-gap='sm' data-role='share-links'>
					<strong>{t('Share with a link')}</strong>
					<p className='ui-meta'>
						{t(
							'Whoever opens one of these links reaches the project, without being invited.',
						)}
					</p>
					<div className='ui-stack' data-gap='xs'>
						<CopyField
							id='share-url'
							label={
								reviewOnly
									? t('Review link')
									: readOnly
										? t('Read only')
										: t('Can edit')
							}
							value={projectUrl}
						/>
						<p className='ui-meta'>
							{reviewOnly
								? t(
										'Anyone with this link can comment and suggest changes to this project, which editors accept or reject.',
									)
								: readOnly
									? t(
											'Anyone with this link can view and compile this project, but not change it.',
										)
									: t('Anyone with this link can edit this project.')}
						</p>
					</div>
					{serverLinks && !readOnly && (
						<div className='ui-stack' data-gap='xs'>
							{readOnlyError ? (
								<div className='ui-message' data-tone='warning'>
									{readOnlyError}
								</div>
							) : (
								<CopyField
									id='share-read-only-url'
									label={t('Read only')}
									value={readOnlyUrl || t('Getting the link...')}
									disabled={!readOnlyUrl}
								/>
							)}
							<p className='ui-meta'>
								{t(
									'Anyone with this link can view and compile this project, but not change it.',
								)}
							</p>
						</div>
					)}
				</section>

				{serverLinks && (
					<details className='share-more' data-role='share-access'>
						<summary>{t('Take back access given by a link')}</summary>
						<div className='ui-stack' data-gap='sm'>
							{accessError && (
								<div className='ui-message' data-tone='warning'>
									{accessError}
								</div>
							)}
							{access === null && (
								<p className='ui-meta'>
									{t(
										'Sign in to a server account to manage who can edit this project.',
									)}
								</p>
							)}
							{access?.owner === 'none' && (
								<div className='ui-actions' data-align='end'>
									<span className='ui-meta'>
										{t(
											"This project has no owner yet. Its owner can replace the editing link to remove someone's access.",
										)}
									</span>
									<button
										type='button'
										className='button secondary'
										disabled={accessBusy}
										onClick={() => void changeAccess({ claim: true })}
									>
										{t('Become the owner')}
									</button>
								</div>
							)}
							{access?.owner === 'other' && (
								<p className='ui-meta'>
									{t("Only the project's owner can replace the editing link.")}
								</p>
							)}
							{access?.owner === 'you' &&
								(confirmEditReplace ? (
									<div className='ui-actions' data-align='end'>
										<span className='ui-meta'>
											{t(
												'Everyone using the current editing link will lose access, except invited collaborators, who follow it. Send the new link to the others who should keep it.',
											)}
										</span>
										<button
											type='button'
											className='button secondary'
											onClick={() => setConfirmEditReplace(false)}
										>
											{t('Cancel')}
										</button>
										<button
											type='button'
											className='button danger'
											disabled={accessBusy}
											onClick={() => {
												setConfirmEditReplace(false);
												void changeAccess({ reset: true });
											}}
										>
											{t('Replace')}
										</button>
									</div>
								) : (
									<div className='ui-actions' data-align='end'>
										<span className='ui-meta'>
											{t('You own this project.')}
										</span>
										<button
											type='button'
											className='button secondary'
											disabled={accessBusy}
											onClick={() => setConfirmEditReplace(true)}
										>
											{t('Replace the editing link')}
										</button>
									</div>
								))}
							{confirmReplace ? (
								<div className='ui-actions' data-align='end'>
									<span className='ui-meta'>
										{t('The current read-only link will stop working.')}
									</span>
									<button
										type='button'
										className='button secondary'
										onClick={() => setConfirmReplace(false)}
									>
										{t('Cancel')}
									</button>
									<button
										type='button'
										className='button danger'
										onClick={() => {
											setConfirmReplace(false);
											setReadOnlyId(null);
											void loadReadOnlyLink(true);
										}}
									>
										{t('Replace')}
									</button>
								</div>
							) : (
								readOnlyUrl && (
									<div className='ui-actions' data-align='end'>
										<button
											type='button'
											className='button secondary'
											onClick={() => setConfirmReplace(true)}
										>
											{t('Replace the read-only link')}
										</button>
									</div>
								)
							)}
						</div>
					</details>
				)}

				<details className='share-more' data-role='share-options'>
					<summary>{t('More options')}</summary>
					<div className='ui-stack' data-gap='md'>
						<div
							className='ui-card ui-stack'
							data-gap='sm'
							data-padding='md'
							data-surface='secondary'
						>
							<label className='checkbox-control'>
								<input
									type='checkbox'
									checked={projectShareEnabled}
									disabled={!hasProjectTools}
									onChange={(event) =>
										preferences.setShareProjectTools(
											projectKey,
											event.target.checked,
										)
									}
								/>
								<span>{t('Share tools used in this project')}</span>
							</label>

							{projectShareEnabled && shareableProjectTools.length > 0 ? (
								<div className='ui-stack' data-gap='xs'>
									<strong>{t('Shared with this project')}</strong>
									<ul>
										{shareableProjectTools.map((tool) => (
											<li key={`${tool.kind}:${tool.config.id}`}>
												{tool.config.name} ·{' '}
												{tool.kind === 'typesetter'
													? t('Typesetter')
													: t('Language Server')}
											</li>
										))}
									</ul>
								</div>
							) : (
								<p className='ui-note'>
									{t('No additional project tools will be shared.')}
								</p>
							)}

							{globallySharedTools.length > 0 && (
								<div className='ui-stack' data-gap='xs'>
									<strong>{t('Already shared with all collaborators')}</strong>
									<ul>
										{globallySharedTools.map((tool) => (
											<li key={`${tool.kind}:${tool.config.id}`}>
												{tool.config.name} ·{' '}
												{tool.kind === 'typesetter'
													? t('Typesetter')
													: t('Language Server')}
											</li>
										))}
									</ul>
								</div>
							)}

							{projectShareEnabled && unavailableProjectTools.length > 0 && (
								<div className='ui-note ui-stack' data-gap='xs'>
									<strong>{t('Not shareable')}</strong>
									<ul>
										{unavailableProjectTools.map((tool) => (
											<li key={`${tool.kind}:${tool.config.id}`}>
												{tool.config.name}
												{tool.shareMessage ? ` — ${tool.shareMessage}` : ''}
											</li>
										))}
									</ul>
								</div>
							)}
						</div>

						{qrCodeUrl && (
							<div className='ui-stack' data-gap='sm'>
								<strong>{t('QR Code')}</strong>
								<div
									className='ui-card ui-stack'
									data-gap='sm'
									data-padding='md'
									data-surface='secondary'
									data-align='center'
								>
									<img
										className='project-share-qr'
										src={qrCodeUrl}
										alt={t('QR Code for project link')}
									/>
									<p className='ui-meta' data-align='center'>
										{t('Scan to open project on mobile')}
									</p>
								</div>
							</div>
						)}
					</div>
				</details>
			</div>
		</Modal>
	);
};

export default ShareProjectModal;
