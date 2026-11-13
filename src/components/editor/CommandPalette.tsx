// src/components/editor/CommandPalette.tsx
// The command palette, as Overleaf's (Ctrl/Cmd+P): a floating window where
// typing finds a command or a file of the project; Enter runs it, Escape
// closes. Also in focus mode.
import type React from 'react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { t } from '@/i18n';
import { highlightPieces, matchText } from '../../utils/commandSearch';
import { keysLabel } from '../../utils/keyLabels';
import type { PaletteCommand } from './editorCommands';

interface CommandPaletteProps {
	isOpen: boolean;
	onClose: () => void;
	/** The commands, asked when it opens. */
	commands: () => PaletteCommand[];
	/** The project's files, asked when it opens. */
	files: () => Promise<PaletteCommand[]>;
}

interface Result {
	command: PaletteCommand;
	score: number;
	ranges: [number, number][];
}

// Enough to choose from; typing narrows the rest.
const MAX_RESULTS = 100;

const rank = (query: string, commands: PaletteCommand[]): Result[] => {
	const results: Result[] = [];
	for (const command of commands) {
		// Its label first; else the words found across the label, the
		// folder, the group and other words (« methode chap »).
		const onLabel = matchText(query, command.label);
		const labelLength = Array.from(command.label).length;
		const across = onLabel
			? null
			: matchText(
					query,
					[command.label, command.detail, command.group, command.keywords]
						.filter(Boolean)
						.join(' '),
				);
		if (!onLabel && !across) continue;
		const score = onLabel ? onLabel.score : (across?.score ?? 0) * 0.6;
		results.push({
			command,
			// Commands before files, but a file named as typed before a
			// command found by other words.
			score: score - (command.file ? 15 : 0),
			ranges:
				onLabel?.ranges ??
				(across?.ranges ?? [])
					.filter(([from]) => from < labelLength)
					.map(([from, to]): [number, number] => [
						from,
						Math.min(to, labelLength),
					]),
		});
	}
	if (!query.trim()) return results.slice(0, MAX_RESULTS);
	return results.sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS);
};

const CommandPalette: React.FC<CommandPaletteProps> = ({
	isOpen,
	onClose,
	commands,
	files,
}) => {
	const [query, setQuery] = useState('');
	const [available, setAvailable] = useState<PaletteCommand[]>([]);
	const [active, setActive] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const returnFocus = useRef<HTMLElement | null>(null);
	const listId = useId();
	// Asked once on opening, whatever changes while it is open.
	const sources = useRef({ commands, files });
	sources.current = { commands, files };

	// What can be done now, then the files once read.
	useEffect(() => {
		if (!isOpen) return;
		returnFocus.current = document.activeElement as HTMLElement | null;
		setQuery('');
		setActive(0);
		const now = sources.current.commands();
		setAvailable(now);
		let cancelled = false;
		sources.current
			.files()
			.then((found) => {
				if (!cancelled) setAvailable([...now, ...found]);
			})
			.catch(() => {});
		requestAnimationFrame(() => inputRef.current?.focus());
		return () => {
			cancelled = true;
		};
	}, [isOpen]);

	const results = useMemo(() => rank(query, available), [query, available]);

	useEffect(() => {
		listRef.current
			?.querySelector<HTMLElement>(`[data-index="${active}"]`)
			?.scrollIntoView({ block: 'nearest' });
	}, [active]);

	if (!isOpen) return null;

	const close = (restoreFocus = true) => {
		onClose();
		if (restoreFocus) returnFocus.current?.focus?.();
	};

	const run = (command: PaletteCommand | undefined) => {
		if (!command) return;
		// Closed first: the command then has the page, and the editor its
		// focus back.
		close();
		requestAnimationFrame(() => command.run());
	};

	const onKeyDown = (event: React.KeyboardEvent) => {
		const count = results.length;
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			if (count) setActive((index) => (index + 1) % count);
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			if (count) setActive((index) => (index - 1 + count) % count);
		} else if (event.key === 'PageDown') {
			event.preventDefault();
			if (count) setActive((index) => Math.min(count - 1, index + 8));
		} else if (event.key === 'PageUp') {
			event.preventDefault();
			setActive((index) => Math.max(0, index - 8));
		} else if (event.key === 'Enter') {
			event.preventDefault();
			run(results[active]?.command);
		} else if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			close();
		} else if (event.key === 'Tab') {
			event.preventDefault();
		}
	};

	const activeId = results[active] ? `${listId}-${active}` : undefined;

	return (
		<div
			className='command-palette-backdrop'
			data-role='command-palette'
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) close();
			}}
		>
			<div
				className='command-palette'
				role='dialog'
				aria-modal='true'
				aria-label={t('Command palette')}
				onKeyDown={onKeyDown}
			>
				<input
					ref={inputRef}
					type='text'
					className='command-palette-input'
					role='combobox'
					aria-expanded='true'
					aria-controls={listId}
					aria-activedescendant={activeId}
					aria-autocomplete='list'
					placeholder={t('Type a command or the name of a file')}
					value={query}
					onChange={(event) => {
						setQuery(event.target.value);
						setActive(0);
					}}
					autoComplete='off'
					spellCheck={false}
				/>
				<div
					ref={listRef}
					id={listId}
					className='command-palette-list'
					role='listbox'
					aria-label={t('Commands and files')}
				>
					{results.map((result, index) => {
						const { command } = result;
						return (
							<div
								key={command.id}
								id={`${listId}-${index}`}
								role='option'
								tabIndex={-1}
								aria-selected={index === active}
								data-index={index}
								data-command={command.id}
								className='command-palette-item'
								onMouseMove={() => {
									if (index !== active) setActive(index);
								}}
								onMouseDown={(event) => event.preventDefault()}
								onClick={() => run(command)}
							>
								<span className='command-palette-text'>
									<span className='command-palette-label'>
										{highlightPieces(command.label, result.ranges).map(
											(piece) =>
												piece.match ? (
													<mark key={piece.at}>{piece.text}</mark>
												) : (
													<span key={piece.at}>{piece.text}</span>
												),
										)}
									</span>
									{command.detail && (
										<span className='command-palette-detail'>
											{command.detail}
										</span>
									)}
								</span>
								{command.keys && (
									<kbd className='command-palette-keys'>
										{keysLabel(command.keys)}
									</kbd>
								)}
								<span className='command-palette-group'>{command.group}</span>
							</div>
						);
					})}
					{results.length === 0 && (
						<div className='command-palette-empty'>{t('No results found')}</div>
					)}
				</div>
			</div>
		</div>
	);
};

export default CommandPalette;
