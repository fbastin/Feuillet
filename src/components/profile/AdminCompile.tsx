// src/components/profile/AdminCompile.tsx
// The administration page's card of the TeX Live servers: their load now
// (compiles running and waiting, of how many accounts), what they did since
// they started (compiles, errors, time limits reached, compiles refused for
// lack of room, how long they took and waited), each other year's server,
// and LanguageTool, which checks grammar. Compile slots are shared fairly
// between accounts (server/texlive/server.js); MAX_CONCURRENT and MAX_QUEUE
// change in /etc/feuillet/docker-compose.override.yml.
import type React from 'react';

import { t } from '@/i18n';
import type {
	AdminCompileStatus,
	AdminOverview,
} from '../../services/AccountSyncService';

// Waits longer than this are worth more room.
const LONG_WAIT_MS = 30_000;

const seconds = (ms: number) =>
	t('{seconds} s', {
		seconds: (ms / 1000).toLocaleString(undefined, {
			maximumFractionDigits: ms < 10_000 ? 1 : 0,
		}),
	});

const average = (total = 0, count = 0) =>
	count > 0 ? seconds(total / count) : '—';

const ServerLines: React.FC<{ server: AdminCompileStatus }> = ({ server }) => (
	<>
		<dt>{t('Compiling now')}</dt>
		<dd data-role='admin-compile-now'>
			{t('{used} of {total}', {
				used: server.compiling ?? 0,
				total: server.maxConcurrent ?? 0,
			})}
		</dd>
		<dt>{t('Waiting')}</dt>
		<dd>{server.queued ?? 0}</dd>
		<dt>{t('Compiles since the start')}</dt>
		<dd data-role='admin-compile-count'>{server.compiles ?? 0}</dd>
		<dt>{t('With errors')}</dt>
		<dd>{server.failed ?? 0}</dd>
		{(server.timedOut ?? 0) > 0 && (
			<>
				<dt>{t('Stopped at the time limit')}</dt>
				<dd>{server.timedOut}</dd>
			</>
		)}
		<dt>{t('Refused, no room left')}</dt>
		<dd data-role='admin-compile-refused'>{server.refused ?? 0}</dd>
		<dt>{t('Average compile')}</dt>
		<dd>{average(server.compileMs, server.compiles)}</dd>
		<dt>{t('Average wait')}</dt>
		<dd>{average(server.waitMs, server.waited)}</dd>
		{(server.longestWaitMs ?? 0) > 0 && (
			<>
				<dt>{t('Longest wait')}</dt>
				<dd>{seconds(server.longestWaitMs ?? 0)}</dd>
			</>
		)}
	</>
);

interface AdminCompileProps {
	compile: AdminOverview['compile'];
	grammar: AdminOverview['grammar'];
}

const AdminCompile: React.FC<AdminCompileProps> = ({ compile, grammar }) => {
	// An older collaboration server tells neither.
	if (compile === undefined && grammar === undefined) return null;
	const servers = compile?.ok ? [compile, ...(compile.others ?? [])] : [];
	const crowded = servers.some(
		(server) =>
			(server.refused ?? 0) > 0 || (server.longestWaitMs ?? 0) > LONG_WAIT_MS,
	);

	return (
		<section className='admin-card' data-role='admin-compile'>
			<h3>{t('Compiling')}</h3>
			{compile === null && (
				<p>
					{t(
						'The collaboration server does not reach TeX Live: TEXLIVE_URL, in deploy/docker-compose.yml.',
					)}
				</p>
			)}
			{compile && !compile.ok && (
				<div
					className='ui-message'
					data-tone='error'
					data-role='admin-compile-down'
				>
					{t(
						'The TeX Live server does not answer: sudo feuillet-compose ps says how the servers are.',
					)}
				</div>
			)}
			{compile?.ok && (
				<>
					<dl>
						<ServerLines server={compile} />
						{(compile.accountsWaiting ?? 0) > 0 && (
							<>
								<dt>{t('Accounts waiting')}</dt>
								<dd>{compile.accountsWaiting}</dd>
							</>
						)}
					</dl>
					{compile.shellEscape === 'restricted' && (
						<div className='ui-message' data-tone='warning'>
							{t(
								'Documents may not run programs: the TeX Live server found a network (sudo docker logs feuillet-texlive).',
							)}
						</div>
					)}
					{(compile.others ?? []).map((other) => (
						<details key={other.year ?? 'other'} data-role='admin-compile-year'>
							<summary>
								{other.ok
									? t('TeX Live {year}', { year: String(other.year) })
									: t('TeX Live {year}: does not answer', {
											year: String(other.year),
										})}
							</summary>
							{other.ok && (
								<dl>
									<ServerLines server={other} />
								</dl>
							)}
						</details>
					))}
					{crowded && (
						<div
							className='ui-message'
							data-tone='warning'
							data-role='admin-compile-crowded'
						>
							{t(
								'Compiles waited long or were refused: MAX_CONCURRENT and MAX_QUEUE give more room, in /etc/feuillet/docker-compose.override.yml, if the machine has it.',
							)}
						</div>
					)}
					<p className='ui-meta'>
						{t(
							'The slots are shared fairly: a free one goes to the account with the fewest compiles running.',
						)}
					</p>
				</>
			)}
			{grammar && (
				<p data-role='admin-grammar'>
					{!grammar.enabled
						? t('Grammar checking is off (GRAMMAR_URL).')
						: grammar.ok
							? t('Grammar checking (LanguageTool) answers.')
							: t(
									'Grammar checking (LanguageTool) does not answer: sudo docker logs feuillet-languagetool.',
								)}
				</p>
			)}
		</section>
	);
};

export default AdminCompile;
