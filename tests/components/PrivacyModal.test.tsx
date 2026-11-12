import { render, screen, waitFor } from '@testing-library/react';

import '@/i18n';
import PrivacyModal from '@/components/common/PrivacyModal';
import {
	type SiteInfo,
	accountSyncService,
} from '@/services/AccountSyncService';

describe('the privacy page', () => {
	afterEach(() => jest.restoreAllMocks());

	it('names the server it is on, which may be anyone’s', () => {
		render(<PrivacyModal isOpen onClose={() => {}} />);
		expect(
			screen.getByText(new RegExp(`hosted at ${window.location.host}\\.`)),
		).toBeTruthy();
		expect(screen.queryByText(/slashbin/)).toBeNull();
	});

	// What differs from one server to another, as it tells (server/collab/site.js).
	it('says what the server tells of itself', async () => {
		const site: SiteInfo = {
			contact: 'privacy@example.org',
			mail: { provider: 'Example Mail', privacy: null },
			webLogDays: 30,
			backupDays: 7,
			signIn: { google: false, orcid: true },
			grammar: false,
		};
		jest.spyOn(accountSyncService, 'siteInfo').mockResolvedValue(site);
		render(<PrivacyModal isOpen onClose={() => {}} />);
		const container = document.body;
		await waitFor(() =>
			expect(container.textContent).toContain('privacy@example.org'),
		);
		const text = container.textContent ?? '';
		expect(
			container.querySelector('[data-role="privacy-host"] a')?.getAttribute('href'),
		).toBe('mailto:privacy@example.org');
		expect(text).toContain('through Example Mail;');
		expect(text).toContain('kept 30 days');
		expect(text).toContain('for 7 days at most');
		expect(text).toContain('ORCID');
		expect(text).not.toMatch(/Google|Gmail|LanguageTool/);
		expect(container.querySelector('[data-role="privacy-mail"] a')).toBeNull();
	});

	it('leaves out the emails of a server that sends none', async () => {
		jest.spyOn(accountSyncService, 'siteInfo').mockResolvedValue({
			contact: null,
			mail: null,
			webLogDays: 14,
			backupDays: 0,
			signIn: { google: false, orcid: false },
			grammar: true,
		});
		render(<PrivacyModal isOpen onClose={() => {}} />);
		const container = document.body;
		await waitFor(() =>
			expect(container.textContent).toContain('until its administrator deletes them'),
		);
		const text = container.textContent ?? '';
		expect(text).not.toMatch(/your email address, if you gave one|Review emails/);
		expect(container.querySelector('[data-role="privacy-mail"]')).toBeNull();
		expect(text).toContain('LanguageTool');
	});
});
