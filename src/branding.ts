// src/branding.ts
// Identity of this build, injected from texlyre.config.ts (`title`,
// `organizationName`/`projectName`). TeXlyre is the upstream project.
export const APP_NAME: string = __APP_NAME__;
export const APP_SOURCE_URL: string = __APP_SOURCE_URL__;
// Feuillet's own guide, in the repository's docs/ folder: in French for a
// French interface, in English otherwise.
export const docsUrl = (language?: string): string =>
	`${APP_SOURCE_URL}/blob/main/docs/${
		language?.toLowerCase().startsWith('fr') ? 'fr' : 'en'
	}/README.md`;
export const UPSTREAM_NAME = 'TeXlyre';
// Feuillet compiles with its own TeX Live server and does not offer the
// Chelys account sign-up, sign-in and profile connection.
export const CHELYS_ACCOUNTS_ENABLED = false;
