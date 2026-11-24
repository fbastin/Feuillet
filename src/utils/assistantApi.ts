// src/utils/assistantApi.ts
// Claude answering a project's requests (\prompt) through Anthropic's API,
// from Feuillet itself (server/collab/promptRunner.js), with the account's
// own API key: this browser keeps it encrypted with the account's password
// (SecretsContext), as it does Git tokens; the server is given it for one
// run and keeps it nowhere.
import { t } from '@/i18n';

export const ASSISTANT_SECRETS_ID = 'assistants';
export const ANTHROPIC_KEY_SECRET = 'anthropic-api-key';

export const ASSISTANT_MODELS = [
	{ id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
	{ id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
	{ id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
] as const;
export const DEFAULT_ASSISTANT_MODEL = ASSISTANT_MODELS[0].id;
export const DEFAULT_ASSISTANT_NAME = 'Claude';

/** What is kept beside the key, unencrypted: never the key itself. */
export interface AssistantKeyMetadata {
	model: string;
	name: string;
	/** The key's first and last characters, to tell keys apart. */
	hint: string;
}

export const keyHint = (key: string): string =>
	key.length > 12 ? `${key.slice(0, 7)}…${key.slice(-4)}` : '…';

export const metadataOf = (
	value: Record<string, unknown> | null | undefined,
): AssistantKeyMetadata => ({
	model:
		typeof value?.model === 'string' &&
		ASSISTANT_MODELS.some((model) => model.id === value.model)
			? value.model
			: DEFAULT_ASSISTANT_MODEL,
	name:
		typeof value?.name === 'string' && value.name.trim()
			? value.name.trim()
			: DEFAULT_ASSISTANT_NAME,
	hint: typeof value?.hint === 'string' ? value.hint : '',
});

/** What went wrong in a run, or in starting one, for the person. */
export const runErrorText = (error?: {
	code: string;
	message?: string;
}): string => {
	switch (error?.code) {
		case 'invalid_key':
			return t('Anthropic did not accept this API key.');
		case 'not_allowed':
			return t('This API key may not use this model.');
		case 'unknown_model':
			return t('This model is not available with this API key.');
		case 'rate_limited':
			return t(
				"Anthropic's API is busy, or this key has reached its limit: try again later.",
			);
		case 'refused':
			return t('Claude declined to answer these requests.');
		case 'too_long':
		case 'too_many_turns':
			return t(
				'Claude stopped before answering every request: start it again for the rest.',
			);
		case 'api_error':
			return error.message
				? t("Anthropic's API answered: {message}", { message: error.message })
				: t("Anthropic's API could not answer.");
		case 'already_running':
			return t("Claude is already answering this project's requests.");
		case 'read_only':
			return t('You can only read this project.');
		case 'unreachable':
			return t('The server could not be reached. Please try again later.');
		default:
			return t('The server could not do this.');
	}
};
