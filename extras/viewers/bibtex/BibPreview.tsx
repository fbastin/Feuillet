// extras/viewers/bibtex/BibPreview.tsx
// An entry as a reference list prints it (src/utils/bibPreview.ts), and the
// message of a change refused, shared by the entries view and its panel.
import type React from 'react';

import { t } from '@/i18n';
import { BibEditError } from '@/utils/bibDocument';
import type { PreviewPiece } from '@/utils/bibPreview';

export const BibPreview: React.FC<{ pieces: PreviewPiece[] }> = ({
	pieces,
}) => (
	<p className='bib-preview-text'>
		{pieces.map((piece, index) =>
			piece.style === 'link' ? (
				<a
					// biome-ignore lint/suspicious/noArrayIndexKey: pieces have no identity.
					key={index}
					href={piece.href}
					target='_blank'
					rel='noopener noreferrer'
				>
					{piece.text}
				</a>
			) : piece.style === 'italic' ? (
				// biome-ignore lint/suspicious/noArrayIndexKey: pieces have no identity.
				<em key={index}>{piece.text}</em>
			) : (
				// biome-ignore lint/suspicious/noArrayIndexKey: pieces have no identity.
				<span key={index}>{piece.text}</span>
			),
		)}
	</p>
);

/** A refused change's message, in the user's language. */
export const editErrorMessage = (error: unknown): string =>
	error instanceof BibEditError
		? t(error.message)
		: error instanceof Error
			? error.message
			: String(error);
