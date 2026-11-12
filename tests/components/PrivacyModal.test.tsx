import { render, screen } from '@testing-library/react';

import '@/i18n';
import PrivacyModal from '@/components/common/PrivacyModal';

describe('the privacy page', () => {
	it('names the server it is on, which may be anyone’s', () => {
		render(<PrivacyModal isOpen onClose={() => {}} />);
		expect(
			screen.getByText(new RegExp(`hosted at ${window.location.host}\\.`)),
		).toBeTruthy();
		expect(screen.queryByText(/slashbin/)).toBeNull();
	});
});
