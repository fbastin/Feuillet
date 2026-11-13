// src/components/common/TagInput.tsx
import type React from 'react';
import { useState } from 'react';

import { t } from '@/i18n';
import { tagStyle } from '../../hooks/useTagColors';

const COMMA_CHARS = /[,،、。，]/;

interface TagInputProps {
	values: string[];
	onChange: (values: string[]) => void;
	placeholder?: string;
	allowedValues?: string[];
	disabled?: boolean;
	/** The colors of tags (utils/tagColors), shown on their badges. */
	colors?: Record<string, string>;
}

export const TagInput: React.FC<TagInputProps> = ({
	values,
	onChange,
	placeholder,
	allowedValues,
	disabled = false,
	colors,
}) => {
	const [inputValue, setInputValue] = useState('');

	const addTag = (raw: string) => {
		const trimmed = raw.trim();
		if (!trimmed) return;
		if (allowedValues && !allowedValues.includes(trimmed)) return;
		if (values.includes(trimmed)) return;
		onChange([...values, trimmed]);
	};

	const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === 'Enter') {
			e.preventDefault();
			addTag(inputValue);
			setInputValue('');
		} else if (e.key === 'Backspace' && !inputValue && values.length > 0) {
			onChange(values.slice(0, -1));
		}
	};

	const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const val = e.target.value;
		const lastChar = val[val.length - 1];
		if (lastChar && COMMA_CHARS.test(lastChar)) {
			addTag(val.slice(0, -1));
			setInputValue('');
		} else {
			setInputValue(val);
		}
	};

	const removeTag = (tag: string) => {
		onChange(values.filter((v) => v !== tag));
	};

	return (
		<div
			className='ui-token-field'
			data-disabled={disabled ? 'true' : undefined}
		>
			{values.map((tag) => (
				<span
					key={tag}
					className='ui-badge'
					data-variant='tag'
					data-colored={colors?.[tag] ? 'true' : undefined}
					style={tagStyle(colors?.[tag])}
					onClick={(e) => e.stopPropagation()}
				>
					{tag}
					{!disabled && (
						<button
							type='button'
							aria-label={t('Remove {tag}', { tag })}
							onClick={() => removeTag(tag)}
							className='ui-icon-button'
							data-variant='ghost'
							data-size='xs'
							title={t('Remove {tag}', { tag })}
						>
							<span aria-hidden='true'>×</span>
						</button>
					)}
				</span>
			))}
			{!disabled && (
				<input
					type='text'
					value={inputValue}
					onChange={handleChange}
					onKeyDown={handleKeyDown}
					placeholder={values.length === 0 ? placeholder : undefined}
					className='ui-field-control'
					data-appearance='bare'
				/>
			)}
		</div>
	);
};
