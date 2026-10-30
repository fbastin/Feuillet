// src/components/project/ProjectTemplatePicker.tsx
// The template of a new LaTeX project, as in Overleaf's New Project menu, in
// French or English.
import type React from 'react';
import { useEffect, useState } from 'react';

import { t } from '@/i18n';
import { projectTemplateService } from '../../services/ProjectTemplateService';
import {
	PROJECT_TEMPLATE_IDS,
	type ProjectTemplateChoice,
	type ProjectTemplateId,
	type TemplateLanguage,
} from '../../utils/projectStarterUtils';

const templateText = (id: ProjectTemplateId): [string, string] => {
	switch (id) {
		case 'blank':
			return [t('Blank project'), t('An empty document, ready to write.')];
		case 'example':
			return [
				t('Example project'),
				t(
					'A short tour of LaTeX: sections, a figure, a table, lists, mathematics and references.',
				),
			];
		case 'article':
			return [
				t('Academic journal'),
				t('An article with an abstract, theorems and a bibliography.'),
			];
		case 'book':
			return [
				t('Book'),
				t('Chapters in their own files, between front and back matter.'),
			];
		case 'letter':
			return [
				t('Formal letter'),
				t('A letter with the sender, the recipient and a subject.'),
			];
		case 'homework':
			return [t('Homework assignment'), t('Exercises and their solutions.')];
		case 'poster':
			return [t('Poster'), t('A conference poster in two columns.')];
		case 'presentation':
			return [
				t('Presentation'),
				t('Beamer slides with columns, blocks and items shown one by one.'),
			];
		case 'report':
			return [
				t('Project or lab report'),
				t('A title page, a table of contents and the usual sections.'),
			];
		case 'cv':
			return [t('Résumé or CV'), t('A one-page résumé made with moderncv.')];
		case 'thesis':
			return [
				t('Thesis or dissertation'),
				t(
					'Front matter, chapters in their own files, a bibliography and appendices.',
				),
			];
	}
};

// Each language is named in itself, as in language menus.
const LANGUAGES: [TemplateLanguage, string][] = [
	['fr', 'Français'],
	['en', 'English'],
];

interface ProjectTemplatePickerProps {
	value: ProjectTemplateChoice;
	onChange: (value: ProjectTemplateChoice) => void;
	disabled?: boolean;
}

const ProjectTemplatePicker: React.FC<ProjectTemplatePickerProps> = ({
	value,
	onChange,
	disabled = false,
}) => {
	const [, selectedDescription] = templateText(value.id);
	const [previews, setPreviews] = useState<
		Partial<Record<ProjectTemplateId, string>>
	>({});

	useEffect(() => {
		let current = true;
		projectTemplateService
			.previewUrls(value.language)
			.then((urls) => {
				if (current) setPreviews(urls);
			})
			.catch(() => {});
		return () => {
			current = false;
		};
	}, [value.language]);

	return (
		<div className='ui-field' data-spacing='section'>
			<div className='project-template-header'>
				<span id='project-template-label' className='project-template-label'>
					{t('Template')}
				</span>
				<select
					className='project-template-language'
					aria-label={t('Template language')}
					title={t('Template language')}
					value={value.language}
					onChange={(event) =>
						onChange({
							...value,
							language: event.target.value as TemplateLanguage,
						})
					}
					disabled={disabled}
				>
					{LANGUAGES.map(([code, name]) => (
						<option key={code} value={code} lang={code}>
							{name}
						</option>
					))}
				</select>
			</div>

			<fieldset
				className='project-template-grid'
				aria-labelledby='project-template-label'
				disabled={disabled}
			>
				{PROJECT_TEMPLATE_IDS.map((id) => {
					const [name, description] = templateText(id);
					const preview = previews[id];
					const selected = id === value.id;
					return (
						<label
							key={id}
							className='project-template-card'
							data-template={id}
							data-selected={selected}
							title={description}
						>
							<input
								type='radio'
								name='project-template'
								value={id}
								checked={selected}
								onChange={() => onChange({ ...value, id })}
							/>
							<span className='project-template-preview'>
								{preview && <img src={preview} alt='' loading='lazy' />}
							</span>
							<span className='project-template-name'>{name}</span>
						</label>
					);
				})}
			</fieldset>

			<div className='ui-note ui-field-hint'>{selectedDescription}</div>
		</div>
	);
};

export default ProjectTemplatePicker;
