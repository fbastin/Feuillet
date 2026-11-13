// src/components/project/TagColorsModal.tsx
// The colors of the project tags, as Overleaf's « Edit tag »: one of nine,
// any other, or none; the tags then show it in the project list.
import type React from 'react';

import { t } from '@/i18n';
import { tagStyle, useTagColors } from '../../hooks/useTagColors';
import { PRESET_TAG_COLORS } from '../../utils/tagColors';
import { ToolbarColorIcon } from '../common/Icons';
import Modal from '../common/Modal';

interface TagColorsModalProps {
	isOpen: boolean;
	onClose: () => void;
	/** Every tag of the account's projects. */
	tags: string[];
}

const colorNames = (): Record<string, string> => ({
	Red: t('Red'),
	Orange: t('Orange'),
	Yellow: t('Yellow'),
	Green: t('Green'),
	Teal: t('Teal'),
	Blue: t('Blue'),
	Purple: t('Purple'),
	Pink: t('Pink'),
	Gray: t('Gray'),
});

const TagColorsModal: React.FC<TagColorsModalProps> = ({
	isOpen,
	onClose,
	tags,
}) => {
	const { colors, setColor } = useTagColors();
	const names = colorNames();
	const sorted = [...tags].sort((a, b) =>
		a.localeCompare(b, undefined, { sensitivity: 'base' }),
	);

	return (
		<Modal
			isOpen={isOpen}
			onClose={onClose}
			title={t('Tag colors')}
			icon={ToolbarColorIcon}
			size='medium'
		>
			<div className='ui-stack' data-gap='md'>
				<p className='ui-note'>
					{t(
						'A color helps to spot a tag in the project list. It follows your account to your other devices.',
					)}
				</p>
				<ul className='tag-colors-list' data-role='tag-colors'>
					{sorted.map((tag) => {
						const current = colors[tag];
						const preset = PRESET_TAG_COLORS.some(
							(entry) => entry.value === current,
						);
						return (
							<li key={tag} data-role='tag-color' data-tag={tag}>
								<span
									className='ui-badge'
									data-variant='tag'
									data-colored={current ? 'true' : undefined}
									style={tagStyle(current)}
								>
									{tag}
								</span>
								<fieldset
									className='tag-swatches'
									aria-label={t('Color of {tag}', { tag })}
								>
									{PRESET_TAG_COLORS.map((entry) => (
										<button
											key={entry.value}
											type='button'
											className='tag-swatch'
											data-color={entry.value}
											aria-pressed={current === entry.value}
											aria-label={names[entry.name]}
											title={names[entry.name]}
											style={tagStyle(entry.value)}
											onClick={() => setColor(tag, entry.value, tags)}
										/>
									))}
									<label
										className='tag-swatch'
										data-custom='true'
										data-selected={current && !preset ? 'true' : undefined}
										title={t('Another color')}
										style={tagStyle(current && !preset ? current : undefined)}
									>
										<input
											type='color'
											aria-label={t('Another color for {tag}', { tag })}
											value={current ?? '#7c8591'}
											onChange={(event) =>
												setColor(tag, event.target.value, tags)
											}
										/>
									</label>
									<button
										type='button'
										className='button secondary'
										data-size='sm'
										data-action='clear-tag-color'
										disabled={!current}
										onClick={() => setColor(tag, null, tags)}
									>
										{t('No color')}
									</button>
								</fieldset>
							</li>
						);
					})}
				</ul>
			</div>
		</Modal>
	);
};

export default TagColorsModal;
