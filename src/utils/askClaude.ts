// src/utils/askClaude.ts
// The message "Ask Claude" prepares: what the person asks, with where they
// are in the project, for Claude to act on through the Feuillet connector
// (server/collab/mcp.js), in claude.ai or in Claude Code.
import { t } from '@/i18n';
import { stripAnnotationTags } from './annotationTagUtils';

/** Longest passage put in the message; Claude reads the rest itself. */
export const MAX_PASSAGE_CHARS = 2000;

export interface AskClaudeContext {
	projectName: string;
	projectId: string;
	path?: string;
	line?: number;
	selection?: string;
}

const fenceFor = (path?: string) =>
	path?.endsWith('.typ')
		? 'typst'
		: path?.endsWith('.bib')
			? 'bibtex'
			: 'latex';

/** The passage as people read it, without comment and suggestion tags. */
export function passageOf(selection?: string): {
	text: string;
	truncated: boolean;
} {
	const clean = stripAnnotationTags(selection ?? '').trim();
	return clean.length > MAX_PASSAGE_CHARS
		? { text: `${clean.slice(0, MAX_PASSAGE_CHARS)}…`, truncated: true }
		: { text: clean, truncated: false };
}

export function askClaudePrompt(
	context: AskClaudeContext,
	request: string,
): string {
	const project = context.projectName.trim() || t('Untitled Project');
	const passage = passageOf(context.selection);
	const where = context.path
		? t(
				'In my Feuillet project "{project}" (id {id}), file {path}, line {line}:',
				{
					project,
					id: context.projectId,
					path: context.path,
					line: context.line ?? 1,
				},
			)
		: t('In my Feuillet project "{project}" (id {id}):', {
				project,
				id: context.projectId,
			});
	const parts = [where];
	if (passage.text) {
		parts.push('', `\`\`\`${fenceFor(context.path)}`, passage.text, '```');
		if (passage.truncated) {
			parts.push(t('(The passage is cut short: read the file for the rest.)'));
		}
	}
	parts.push('', request.trim());
	parts.push(
		'',
		t(
			'Use the Feuillet connector: read the file first, then make your changes with edit_file, as suggestions.',
		),
	);
	return parts.join('\n');
}

/**
 * What to ask for the project's requests (\prompt, feuillet.sty). It says
 * what they are and how to answer them without the connector's
 * list_requests and answer_request too: a client may keep the tools the
 * connector had when it was added (claude.ai's apps do), and then knows
 * nothing of requests; search and edit_file are as old as the connector.
 */
export const answerRequestsText = (): string =>
	t(
		"Answer the requests for assistants in this project. People write them in its LaTeX files as \\prompt{…} (Feuillet's feuillet.sty package), or \\prompt[name]{…} for one assistant; each asks for text or for work where it stands. List them with list_requests, then answer each with answer_request: your answer replaces the whole request, \\prompt{…} included, as a suggestion that people accept or reject. If you do not have these tools, find the requests with search (\\prompt), read each with the text around it, and replace each whole \\prompt{…} with its answer through edit_file, as a suggestion. Leave the requests that name another assistant, and those in comments.",
	);

/**
 * The message for the project's requests: the project, then the request,
 * which says itself how to answer (the cursor's place does not matter).
 */
export function askClaudeRequestsPrompt(
	context: AskClaudeContext,
	request: string,
): string {
	const project = context.projectName.trim() || t('Untitled Project');
	return [
		t('In my Feuillet project "{project}" (id {id}):', {
			project,
			id: context.projectId,
		}),
		'',
		request.trim(),
	].join('\n');
}

/**
 * Opens « Ask Claude » from elsewhere than its button (an error of the
 * log, say), with where and what already filled in.
 */
export const ASK_CLAUDE_EVENT = 'feuillet-ask-claude';

export interface AskClaudeRequest {
	path?: string;
	line?: number;
	selection?: string;
	request: string;
}

export const askClaude = (detail: AskClaudeRequest): void => {
	document.dispatchEvent(
		// One editor's dialog takes it: the first cancels it for the others.
		new CustomEvent(ASK_CLAUDE_EVENT, { detail, cancelable: true }),
	);
};

/** claude.ai with the message ready to send. */
export const claudeUrl = (prompt: string) =>
	`https://claude.ai/new?q=${encodeURIComponent(prompt)}`;
