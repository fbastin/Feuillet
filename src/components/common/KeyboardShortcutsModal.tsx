// src/components/KeyboardShortcutsModal.tsx
import type React from 'react';
import { useState } from 'react';

import { t } from '@/i18n';
import SettingsModal from '../settings/SettingsModal';
import { KeyboardIcon } from './Icons';
import Modal from './Modal';

interface KeyboardShortcutsModalProps {
	isOpen: boolean;
	onClose: () => void;
}

const KeyboardShortcutsModal: React.FC<KeyboardShortcutsModalProps> = ({
	isOpen,
	onClose,
}) => {
	const [showSettings, setShowSettings] = useState(false);

	return (
		<>
			<Modal
				isOpen={isOpen}
				onClose={onClose}
				title={t('Keyboard Shortcuts')}
				icon={KeyboardIcon}
				size='medium'
			>
				<div className='ui-stack' data-gap='xl'>
					<section className='ui-stack' data-gap='md'>
						<h3 className='ui-panel-title'>{t('Global Shortcuts')}</h3>
						<p className='ui-note'>
							{t('These shortcuts work anywhere in the application')}
						</p>

						<div className='ui-list' data-gap='sm'>
							<div
								className='ui-list-item'
								data-align='center'
								data-gap='md'
								data-padding='sm'
								data-surface='secondary'
							>
								<div className='ui-actions' data-wrap='true'>
									<kbd>{t('F9')}</kbd>
								</div>
								<div className='ui-list-content'>{t('Compile document')}</div>
							</div>

							<div
								className='ui-list-item'
								data-align='center'
								data-gap='md'
								data-padding='sm'
								data-surface='secondary'
							>
								<div className='ui-actions' data-wrap='true'>
									<kbd>{t('Ctrl')}</kbd> / <kbd>⌘</kbd> +{' '}
									<kbd>{t('Enter')}</kbd>
								</div>
								<div className='ui-list-content'>
									{t('Save and compile document')}
								</div>
							</div>

							<div
								className='ui-list-item'
								data-align='center'
								data-gap='md'
								data-padding='sm'
								data-surface='secondary'
							>
								<div className='ui-actions' data-wrap='true'>
									<kbd>{t('Shift')}</kbd> + <kbd>{t('F9')}</kbd>
								</div>
								<div className='ui-list-content'>
									{t('Compile with cleared cache')}
								</div>
							</div>

							<div
								className='ui-list-item'
								data-align='center'
								data-gap='md'
								data-padding='sm'
								data-surface='secondary'
							>
								<div className='ui-actions' data-wrap='true'>
									<kbd>{t('F8')}</kbd>
								</div>
								<div className='ui-list-content'>{t('Stop compilation')}</div>
							</div>

							<div
								className='ui-list-item'
								data-align='center'
								data-gap='md'
								data-padding='sm'
								data-surface='secondary'
							>
								<div className='ui-actions' data-wrap='true'>
									<kbd>{t('Ctrl')}</kbd> + <kbd>{t('Shift')}</kbd> +{' '}
									<kbd>F</kbd>
								</div>
								<div className='ui-list-content'>{t('Open search panel')}</div>
							</div>

							<div
								className='ui-list-item'
								data-align='center'
								data-gap='md'
								data-padding='sm'
								data-surface='secondary'
							>
								<div className='ui-actions' data-wrap='true'>
									<kbd>{t('Ctrl')}</kbd> + <kbd>{t('Shift')}</kbd> +{' '}
									<kbd>H</kbd>
								</div>
								<div className='ui-list-content'>
									{t('Open search and replace panel')}
								</div>
							</div>

							<div
								className='ui-list-item'
								data-align='center'
								data-gap='md'
								data-padding='sm'
								data-surface='secondary'
							>
								<div className='ui-actions' data-wrap='true'>
									<kbd>{t('Ctrl')}</kbd> / <kbd>⌘</kbd> +{' '}
									<kbd>{t('Shift')}</kbd> + <kbd>M</kbd>
								</div>
								<div className='ui-list-content'>
									{t('Focus mode: the editor and the PDF alone')}
								</div>
							</div>
						</div>
					</section>

					<section className='ui-stack' data-gap='md'>
						<h3 className='ui-panel-title'>{t('Editor Shortcuts')}</h3>
						<p className='ui-note'>
							{t('These shortcuts work when the editor is focused')}
						</p>

						<div className='ui-list' data-gap='sm'>
							<div
								className='ui-list-item'
								data-align='center'
								data-gap='md'
								data-padding='sm'
								data-surface='secondary'
							>
								<div className='ui-actions' data-wrap='true'>
									<kbd>{t('Ctrl')}</kbd> / <kbd>⌘</kbd> + <kbd>S</kbd>
								</div>
								<div className='ui-list-content'>
									{t('Save current file and compile')}
								</div>
							</div>

							<div
								className='ui-list-item'
								data-align='center'
								data-gap='md'
								data-padding='sm'
								data-surface='secondary'
							>
								<div className='ui-actions' data-wrap='true'>
									<kbd>{t('Ctrl')}</kbd> + <kbd>{t('Shift')}</kbd> +{' '}
									<kbd>I</kbd>
								</div>
								<div className='ui-list-content'>{t('Format document')}</div>
							</div>
							<div
								className='ui-list-item'
								data-align='center'
								data-gap='md'
								data-padding='sm'
								data-surface='secondary'
							>
								<div className='ui-actions' data-wrap='true'>
									<kbd>{t('Ctrl')}</kbd> / <kbd>⌘</kbd> + <kbd>B</kbd>
								</div>
								<div className='ui-list-content'>
									{t('Bold (LaTeX and Typst)')}
								</div>
							</div>
							<div
								className='ui-list-item'
								data-align='center'
								data-gap='md'
								data-padding='sm'
								data-surface='secondary'
							>
								<div className='ui-actions' data-wrap='true'>
									<kbd>{t('Ctrl')}</kbd> / <kbd>⌘</kbd> + <kbd>I</kbd>
								</div>
								<div className='ui-list-content'>
									{t(
										'Italic (LaTeX and Typst); in other files, expand selection',
									)}
								</div>
							</div>
							<div
								className='ui-list-item'
								data-align='center'
								data-gap='md'
								data-padding='sm'
								data-surface='secondary'
							>
								<div className='ui-actions' data-wrap='true'>
									<kbd>{t('Alt')}</kbd> + <kbd>C</kbd>, <kbd>{t('Ctrl')}</kbd> +{' '}
									<kbd>{t('Shift')}</kbd> + <kbd>C</kbd>
								</div>
								<div className='ui-list-content'>
									{t('Add comment to selection')}
								</div>
							</div>

							<div
								className='ui-list-item'
								data-align='center'
								data-gap='md'
								data-padding='sm'
								data-surface='secondary'
							>
								<div className='ui-actions' data-wrap='true'>
									<kbd>{t('Tab')}</kbd>
								</div>
								<div className='ui-list-content'>{t('Indent selection')}</div>
							</div>

							<div
								className='ui-list-item'
								data-align='center'
								data-gap='md'
								data-padding='sm'
								data-surface='secondary'
							>
								<div className='ui-actions' data-wrap='true'>
									<kbd>{t('Ctrl')}</kbd> / <kbd>⌘</kbd> + <kbd>/</kbd>
								</div>
								<div className='ui-list-content'>
									{t('Comment or uncomment the lines')}
								</div>
							</div>

							<div
								className='ui-list-item'
								data-align='center'
								data-gap='md'
								data-padding='sm'
								data-surface='secondary'
							>
								<div className='ui-actions' data-wrap='true'>
									<kbd>{t('Ctrl')}</kbd> / <kbd>⌘</kbd> + <kbd>U</kbd>
								</div>
								<div className='ui-list-content'>{t('To upper case')}</div>
							</div>

							<div
								className='ui-list-item'
								data-align='center'
								data-gap='md'
								data-padding='sm'
								data-surface='secondary'
							>
								<div className='ui-actions' data-wrap='true'>
									<kbd>{t('Ctrl')}</kbd> / <kbd>⌘</kbd> +{' '}
									<kbd>{t('Shift')}</kbd> + <kbd>U</kbd>
								</div>
								<div className='ui-list-content'>{t('To lower case')}</div>
							</div>

							<div
								className='ui-list-item'
								data-align='center'
								data-gap='md'
								data-padding='sm'
								data-surface='secondary'
							>
								<div className='ui-actions' data-wrap='true'>
									<kbd>{t('Ctrl')}</kbd> / <kbd>⌘</kbd> +{' '}
									<kbd>{t('Shift')}</kbd> + <kbd>L</kbd>
								</div>
								<div className='ui-list-content'>{t('Go to line')}</div>
							</div>

							<div
								className='ui-list-item'
								data-align='center'
								data-gap='md'
								data-padding='sm'
								data-surface='secondary'
							>
								<div className='ui-actions' data-wrap='true'>
									<kbd>{t('Ctrl')}</kbd> / <kbd>⌘</kbd> + <kbd>J</kbd>
								</div>
								<div className='ui-list-content'>
									{t('Show or hide the review panel')}
								</div>
							</div>

							<div
								className='ui-list-item'
								data-align='center'
								data-gap='md'
								data-padding='sm'
								data-surface='secondary'
							>
								<div className='ui-actions' data-wrap='true'>
									<kbd>{t('Ctrl')}</kbd> / <kbd>⌘</kbd> +{' '}
									<kbd>{t('Shift')}</kbd> + <kbd>A</kbd>
								</div>
								<div className='ui-list-content'>
									{t('Turn track changes on or off')}
								</div>
							</div>

							<div
								className='ui-list-item'
								data-align='center'
								data-gap='md'
								data-padding='sm'
								data-surface='secondary'
							>
								<div className='ui-actions' data-wrap='true'>
									<kbd>{t('Ctrl')}</kbd> + <kbd>F</kbd>
								</div>
								<div className='ui-list-content'>{t('Find in document')}</div>
							</div>

							<div
								className='ui-list-item'
								data-align='center'
								data-gap='md'
								data-padding='sm'
								data-surface='secondary'
							>
								<div className='ui-actions' data-wrap='true'>
									<kbd>{t('Ctrl')}</kbd> + <kbd>H</kbd>
								</div>
								<div className='ui-list-content'>
									{t('Find and replace in document')}
								</div>
							</div>

							<div
								className='ui-list-item'
								data-align='center'
								data-gap='md'
								data-padding='sm'
								data-surface='secondary'
							>
								<div className='ui-actions' data-wrap='true'>
									<kbd>{t('Ctrl')}</kbd> + <kbd>Z</kbd>
								</div>
								<div className='ui-list-content'>{t('Undo')}</div>
							</div>

							<div
								className='ui-list-item'
								data-align='center'
								data-gap='md'
								data-padding='sm'
								data-surface='secondary'
							>
								<div className='ui-actions' data-wrap='true'>
									<kbd>{t('Ctrl')}</kbd> + <kbd>Y</kbd>
								</div>
								<div className='ui-list-content'>{t('Redo')}</div>
							</div>

							<div
								className='ui-list-item'
								data-align='center'
								data-gap='md'
								data-padding='sm'
								data-surface='secondary'
							>
								<div className='ui-actions' data-wrap='true'>
									<kbd>{t('Ctrl')}</kbd> / <kbd>⌘</kbd> + <kbd>D</kbd>
								</div>
								<div className='ui-list-content'>{t('Delete the line')}</div>
							</div>

							<div
								className='ui-list-item'
								data-align='center'
								data-gap='md'
								data-padding='sm'
								data-surface='secondary'
							>
								<div className='ui-actions' data-wrap='true'>
									<kbd>{t('Ctrl')}</kbd> + <kbd>{t('Alt')}</kbd> + <kbd>→</kbd>{' '}
									/ <kbd>←</kbd>
								</div>
								<div className='ui-list-content'>
									{t('Select the next or previous occurrence too')}
								</div>
							</div>

							<div
								className='ui-list-item'
								data-align='center'
								data-gap='md'
								data-padding='sm'
								data-surface='secondary'
							>
								<div className='ui-actions' data-wrap='true'>
									<kbd>{t('Ctrl')}</kbd> + <kbd>{t('Alt')}</kbd> + <kbd>↑</kbd>{' '}
									/ <kbd>↓</kbd>
								</div>
								<div className='ui-list-content'>
									{t('Add a cursor on the line above or below')}
								</div>
							</div>

							<div
								className='ui-list-item'
								data-align='center'
								data-gap='md'
								data-padding='sm'
								data-surface='secondary'
							>
								<div className='ui-actions' data-wrap='true'>
									<kbd>{t('Ctrl')}</kbd> / <kbd>⌘</kbd> + {t('click')}
								</div>
								<div className='ui-list-content'>{t('Add a cursor')}</div>
							</div>

							<div
								className='ui-list-item'
								data-align='center'
								data-gap='md'
								data-padding='sm'
								data-surface='secondary'
							>
								<div className='ui-actions' data-wrap='true'>
									<kbd>{t('Alt')}</kbd> + {t('drag')}
								</div>
								<div className='ui-list-content'>{t('Select a rectangle')}</div>
							</div>

							<div
								className='ui-list-item'
								data-align='center'
								data-gap='md'
								data-padding='sm'
								data-surface='secondary'
							>
								<div className='ui-actions' data-wrap='true'>
									<kbd>{t('Escape')}</kbd>
								</div>
								<div className='ui-list-content'>
									{t('Keep only the main cursor')}
								</div>
							</div>
						</div>
					</section>

					<div className='ui-message' data-tone='info'>
						<p>
							<strong>{t('Note: ')}&nbsp;</strong>
							{t(
								'Some shortcuts may vary depending on your operating system and browser.',
							)}
						</p>
						<p>
							{t('Use')}{' '}
							<button
								type='button'
								className='button'
								data-variant='text'
								onClick={() => setShowSettings(true)}
							>
								{t('Editor keybindings')}
							</button>{' '}
							{t('to choose the editor keybinding mode.')} {t('In Vim mode,')}{' '}
							<kbd>{t('Ctrl')}</kbd> + <kbd>C</kbd>{' '}
							{t('switches between insert and normal mode.')}
						</p>
					</div>
				</div>
			</Modal>

			<SettingsModal
				isOpen={showSettings}
				onClose={() => setShowSettings(false)}
				initialCategory={t('Viewers')}
				initialSubcategory={t('Text Editor')}
			/>
		</>
	);
};

export default KeyboardShortcutsModal;
