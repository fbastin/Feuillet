jest.mock('../../src/branding', () => ({
	APP_NAME: 'Feuillet',
	APP_SOURCE_URL: 'https://github.com/fbastin/Feuillet',
	UPSTREAM_NAME: 'TeXlyre',
}));

import { t } from '../../src/i18n';

describe('app name post-processing', () => {
	it('renames the upstream app in translated strings', () => {
		expect(t('Loading TeXlyre...')).toBe('Loading Feuillet...');
		expect(t("Guest sessions allow you to try TeXlyre's editor")).toBe(
			"Guest sessions allow you to try Feuillet's editor",
		);
	});

	it('leaves lowercase identifiers and opted-out strings alone', () => {
		expect(t('texlyre-project-1')).toBe('texlyre-project-1');
		expect(
			t('Based on {project}', {
				project: 'TeXlyre',
				applyPostProcessor: false,
			}),
		).toBe('Based on TeXlyre');
	});
});
