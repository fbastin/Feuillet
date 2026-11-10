// src/components/comments/MessageEditor.tsx
// Rewrites a comment or a reply one wrote, as Overleaf's Edit: Enter saves,
// Shift+Enter starts a new line, Escape gives up.
import type React from 'react';
import { useEffect, useRef, useState } from 'react';

import { t } from '@/i18n';

interface MessageEditorProps {
	initial: string;
	onSave: (content: string) => void;
	onCancel: () => void;
}

const MessageEditor: React.FC<MessageEditorProps> = ({
	initial,
	onSave,
	onCancel,
}) => {
	const [content, setContent] = useState(initial);
	const fieldRef = useRef<HTMLTextAreaElement>(null);
	const changed = content.trim() !== '' && content.trim() !== initial.trim();

	useEffect(() => {
		const field = fieldRef.current;
		if (!field) return;
		field.focus();
		field.setSelectionRange(field.value.length, field.value.length);
	}, []);

	const save = () => {
		if (changed) onSave(content.trim());
		else onCancel();
	};

	return (
		<div className='ui-stack' data-gap='sm' data-role='message-editor'>
			<textarea
				ref={fieldRef}
				value={content}
				onChange={(event) => setContent(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === 'Enter' && !event.shiftKey) {
						event.preventDefault();
						save();
					} else if (event.key === 'Escape') {
						event.preventDefault();
						event.stopPropagation();
						onCancel();
					}
				}}
				rows={Math.min(6, Math.max(2, content.split('\n').length))}
				className='ui-field-control'
			/>
			<div
				className='ui-actions'
				data-variant='form'
				data-align='end'
				data-cross='stretch'
			>
				<button type='button' className='button secondary' onClick={onCancel}>
					{t('Cancel')}
				</button>
				<button
					type='button'
					className='button primary'
					data-action='save-message'
					onClick={save}
					disabled={!changed}
				>
					{t('Save')}
				</button>
			</div>
		</div>
	);
};

export default MessageEditor;
