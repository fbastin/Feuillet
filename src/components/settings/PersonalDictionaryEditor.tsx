// src/components/settings/PersonalDictionaryEditor.tsx
// The words added to one's spelling dictionary, as Overleaf's « Dictionary:
// Edit »: each can be taken out, and a word added; the account takes the
// change to its other devices.
import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { t } from '@/i18n';
import { useAuth } from '../../hooks/useAuth';
import { personalDictionaryService } from '../../services/PersonalDictionaryService';

// As the spell checker finds words, and the account server keeps them.
const WORD = /^[\p{L}\p{M}'’·-]{1,100}$/u;

const PersonalDictionaryEditor: React.FC = () => {
	const { user } = useAuth();
	const userId = user?.id ?? null;
	const [version, setVersion] = useState(0);
	const [draft, setDraft] = useState('');
	const [problem, setProblem] = useState('');

	useEffect(
		() =>
			personalDictionaryService.addListener((changed) => {
				if (changed === userId) setVersion((value) => value + 1);
			}),
		[userId],
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: version is the dictionary's change count.
	const words = useMemo(
		() =>
			userId
				? personalDictionaryService
						.entries(userId)
						.filter((entry) => !entry.deleted)
						.map((entry) => entry.word)
						.sort((a, b) => a.localeCompare(b))
				: [],
		[userId, version],
	);

	const add = useCallback(() => {
		const word = draft.trim();
		if (!word) return;
		if (!WORD.test(word)) {
			setProblem(
				t('A word has letters only, with apostrophes or hyphens inside.'),
			);
			return;
		}
		personalDictionaryService.add(word);
		setDraft('');
		setProblem('');
	}, [draft]);

	if (!userId) return null;

	return (
		<div
			className='ui-field personal-dictionary'
			data-role='personal-dictionary'
		>
			<label htmlFor='personal-dictionary-word'>
				{t('Words added to the dictionary')}
			</label>
			<div className='ui-meta'>
				{t(
					'The spell checker accepts them in every project; your account takes them to your other devices.',
				)}
			</div>
			<form
				className='personal-dictionary-add'
				onSubmit={(event) => {
					event.preventDefault();
					add();
				}}
			>
				<input
					id='personal-dictionary-word'
					type='text'
					value={draft}
					placeholder={t('A word to accept')}
					onChange={(event) => {
						setDraft(event.target.value);
						setProblem('');
					}}
				/>
				<button
					type='submit'
					className='button secondary'
					data-action='add-dictionary-word'
					disabled={!draft.trim()}
				>
					{t('Add')}
				</button>
			</form>
			{problem && (
				<div className='ui-message' data-tone='warning' role='status'>
					{problem}
				</div>
			)}
			{words.length === 0 ? (
				<div className='ui-meta' data-role='personal-dictionary-empty'>
					{t(
						'No word added yet: right-click an underlined word, then « Add to dictionary ».',
					)}
				</div>
			) : (
				<ul className='personal-dictionary-words'>
					{words.map((word) => (
						<li key={word} data-word={word}>
							<span>{word}</span>
							<button
								type='button'
								className='ui-icon-button'
								data-variant='ghost'
								data-action='remove-dictionary-word'
								title={t('Remove {word} from the dictionary', { word })}
								aria-label={t('Remove {word} from the dictionary', { word })}
								onClick={() => personalDictionaryService.remove(word)}
							>
								×
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	);
};

export default PersonalDictionaryEditor;
