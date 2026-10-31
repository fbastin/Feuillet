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

/** claude.ai with the message ready to send. */
export const claudeUrl = (prompt: string) =>
	`https://claude.ai/new?q=${encodeURIComponent(prompt)}`;
