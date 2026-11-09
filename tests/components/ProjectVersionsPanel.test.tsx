import { act, fireEvent, render, screen } from '@testing-library/react';

jest.mock('@/i18n', () => ({
	t: (key: string, options: Record<string, unknown> = {}) =>
		key.replace(/\{(\w+)\}/g, (_, name) => String(options[name] ?? '')),
}));

const SAVED = 120;
const versions = Array.from({ length: SAVED }, (_, i) => ({
	id: `${String(1_700_000_000_000 - i * 3_600_000)}-0000000${i % 10}`,
	time: 1_700_000_000_000 - i * 3_600_000,
	authors: ['Marie'],
	changes: [{ path: '/main.tex', type: 'modified' }],
}));
const labels = [
	{ id: 'a'.repeat(16), version: versions[80].id, name: 'Soumis', by: 'Marie', time: 1 },
];
const loadHistory = jest.fn(async () => ({ versions, labels }));

jest.mock('@src/services/ProjectHistoryService', () => ({
	projectHistoryService: { loadHistory: (...args: unknown[]) => loadHistory(...args) },
}));
jest.mock('@src/hooks/useCollab', () => ({
	useCollab: () => ({ data: { documents: [] }, readOnly: false }),
}));
jest.mock('@src/hooks/useAuth', () => ({ useAuth: () => ({ user: { username: 'marie' } }) }));
jest.mock('@src/hooks/useSettings', () => ({
	useSettings: () => ({
		getSetting: (id: string) =>
			id === 'collab-provider-type'
				? { value: 'websocket' }
				: id === 'collab-websocket-server'
					? { value: 'ws://localhost:1234' }
					: undefined,
	}),
}));
jest.mock('@src/utils/serverFileSyncUtils', () => ({ collabHttpBaseUrl: () => 'http://localhost:1234' }));
jest.mock('@src/services/CollabService', () => ({ collabService: {} }));
jest.mock('@src/services/FileStoreService', () => ({ fileStoreService: {} }));
jest.mock('@src/services/PeerFileSyncService', () => ({ peerFileSyncService: {} }));
jest.mock('@src/utils/archiveUtils', () => ({}));
jest.mock('@src/utils/versionArchive', () => ({}));

import ProjectVersionsPanel from '@src/components/history/ProjectVersionsPanel';

const items = () => document.querySelectorAll('.versions-item').length;

describe('ProjectVersionsPanel', () => {
	const renderPanel = async () => {
		render(
			<ProjectVersionsPanel projectId='p1' onOpenDiff={jest.fn()} onClearDiff={jest.fn()} />,
		);
		await act(async () => {});
	};

	// A project keeps up to 1,000 versions: drawing them all made the panel
	// take a second to open, and as long to tick one to compare.
	it('shows the latest 50 versions, and the older ones on request', async () => {
		await renderPanel();
		expect(items()).toBe(50);
		const more = screen.getByText('Show older versions (70 more)');
		fireEvent.click(more);
		expect(items()).toBe(SAVED);
		expect(screen.queryByText(/Show older versions/)).toBeNull();
	});

	it('lists the labelled versions apart, each tab as it was left', async () => {
		await renderPanel();
		fireEvent.click(screen.getByText('Show older versions (70 more)'));
		fireEvent.click(screen.getByText('Labels'));
		expect(items()).toBe(1);
		expect(screen.getByText('Soumis')).toBeTruthy();
		fireEvent.click(screen.getByText('All history'));
		expect(items()).toBe(SAVED);
	});

	it('keeps ticking a version to compare as before', async () => {
		await renderPanel();
		const boxes = document.querySelectorAll<HTMLInputElement>('.versions-compare-check');
		fireEvent.click(boxes[3]);
		expect(boxes[3].checked).toBe(true);
		expect(screen.getByText('Tick another version to compare them.')).toBeTruthy();
		expect(boxes[3].closest('.versions-item')?.getAttribute('data-compared')).toBe('true');
		expect(document.querySelectorAll('.versions-item[data-compared]').length).toBe(1);
	});
});
