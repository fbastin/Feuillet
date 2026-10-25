// src/branding.ts
// Identity of this build, injected from texlyre.config.ts (`title`,
// `organizationName`/`projectName`). TeXlyre is the upstream project.
export const APP_NAME: string = __APP_NAME__;
export const APP_SOURCE_URL: string = __APP_SOURCE_URL__;
export const UPSTREAM_NAME = 'TeXlyre';
// Feuillet compiles with its own TeX Live server and does not offer the
// Chelys account sign-up, sign-in and profile connection.
export const CHELYS_ACCOUNTS_ENABLED = false;
