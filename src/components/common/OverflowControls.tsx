// src/components/common/OverflowControls.tsx
// A header's control groups on one line: when they do not fit, the least
// used go into a « … » menu, so that those that matter most (review,
// comments, Claude) stay in view instead of scrolling out of it.
import type React from 'react';
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from 'react';

import { t } from '@/i18n';
import { MoreHorizontalIcon } from './Icons';
import Popover from './Popover';

export interface OverflowItem {
	key: string;
	node: React.ReactNode;
	/** Higher stays longer; Infinity never goes into the menu. */
	priority: number;
}

interface OverflowControlsProps {
	items: OverflowItem[];
}

// Inside these, a click belongs to a control of the menu (its own dropdowns
// and dialogs), which closing the menu would take away.
const MENU_PARTS = '.ui-menu, [role="dialog"], [data-role="modal"]';

const gapOf = (element: Element) =>
	Number.parseFloat(getComputedStyle(element).columnGap) || 0;

/** The keys to move into the menu for the items to fit in `available`. */
export function overflowingKeys(
	items: readonly OverflowItem[],
	widths: ReadonlyMap<string, number>,
	available: number,
	gap: number,
	moreWidth: number,
): string[] {
	const width = (key: string) => widths.get(key) ?? 0;
	const shown = items.filter((item) => width(item.key) > 0);
	const total = (list: readonly OverflowItem[]) =>
		list.reduce((sum, item) => sum + width(item.key), 0) +
		Math.max(0, list.length - 1) * gap;
	if (total(shown) <= available) return [];

	// The least important first; among equals, the rightmost.
	const order = shown
		.map((item, index) => ({ item, index }))
		.filter(({ item }) => item.priority !== Number.POSITIVE_INFINITY)
		.sort((a, b) => a.item.priority - b.item.priority || b.index - a.index);
	const hidden = new Set<string>();
	let kept = shown;
	for (const { item } of order) {
		if (total(kept) + gap + moreWidth <= available) break;
		hidden.add(item.key);
		kept = kept.filter((entry) => entry.key !== item.key);
	}
	return items.filter((item) => hidden.has(item.key)).map((item) => item.key);
}

const OverflowControls: React.FC<OverflowControlsProps> = ({ items }) => {
	const rowRef = useRef<HTMLDivElement>(null);
	const moreRef = useRef<HTMLButtonElement>(null);
	// Widths as last seen in the row, which the menu's items keep.
	const widths = useRef(new Map<string, number>());
	const moreWidth = useRef(32);
	const [hidden, setHidden] = useState<string[]>([]);
	const [menuOpen, setMenuOpen] = useState(false);
	const itemsRef = useRef(items);
	itemsRef.current = items;

	const layout = useCallback(() => {
		const row = rowRef.current;
		const container = row?.parentElement;
		const header = row?.closest<HTMLElement>('.ui-panel-header');
		if (!row || !container || !header) return;

		for (const element of row.querySelectorAll<HTMLElement>(
			':scope > [data-overflow-key]',
		)) {
			widths.current.set(
				element.dataset.overflowKey ?? '',
				element.getBoundingClientRect().width,
			);
		}
		if (moreRef.current) {
			moreWidth.current =
				moreRef.current.parentElement?.getBoundingClientRect().width ??
				moreWidth.current;
		}

		// The controls get a line of their own before they overflow: the
		// header's width, less what goes with them (the collaborators).
		const style = getComputedStyle(header);
		let available =
			header.clientWidth -
			Number.parseFloat(style.paddingLeft) -
			Number.parseFloat(style.paddingRight);
		for (const sibling of container.children) {
			if (sibling === row) continue;
			available -= sibling.getBoundingClientRect().width + gapOf(container);
		}

		const next = overflowingKeys(
			itemsRef.current,
			widths.current,
			Math.floor(available) - 1,
			gapOf(row),
			moreWidth.current,
		);
		setHidden((current) =>
			current.length === next.length &&
			current.every((key, index) => key === next[index])
				? current
				: next,
		);
	}, []);

	// Items come and go with the file opened: measured before the first
	// paint without them. Measuring after every render instead made the
	// browser lay the whole page out again at each of the editor's renders.
	const keys = items.map((item) => item.key).join('\n');
	// biome-ignore lint/correctness/useExhaustiveDependencies: keys stands for items
	useLayoutEffect(() => {
		layout();
	}, [layout, keys]);

	// Otherwise, when a size changes: the header's, an item's (a label or a
	// count), or that of what shares the line (the collaborators). Read
	// once the browser has laid the page out, this costs no layout of its own.
	// biome-ignore lint/correctness/useExhaustiveDependencies: the row's children change with keys and hidden
	useEffect(() => {
		const row = rowRef.current;
		const container = row?.parentElement;
		const header = row?.closest<HTMLElement>('.ui-panel-header');
		if (!row || !container || !header || typeof ResizeObserver === 'undefined')
			return;
		const observer = new ResizeObserver(() => layout());
		observer.observe(header);
		observer.observe(row);
		for (const element of row.children) observer.observe(element);
		for (const sibling of container.children) {
			if (sibling !== row) observer.observe(sibling);
		}
		return () => observer.disconnect();
	}, [layout, keys, hidden]);

	useEffect(() => {
		if (hidden.length === 0) setMenuOpen(false);
	}, [hidden.length]);

	useEffect(() => {
		if (!menuOpen) return;
		const close = (event: MouseEvent) => {
			const target = event.target as Element | null;
			if (target?.closest(MENU_PARTS)) return;
			if (moreRef.current?.contains(target)) return;
			setMenuOpen(false);
		};
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === 'Escape') setMenuOpen(false);
		};
		document.addEventListener('mousedown', close);
		document.addEventListener('keydown', closeOnEscape);
		return () => {
			document.removeEventListener('mousedown', close);
			document.removeEventListener('keydown', closeOnEscape);
		};
	}, [menuOpen]);

	const inMenu = new Set(hidden);

	return (
		<div className='overflow-controls' ref={rowRef}>
			{items
				.filter((item) => !inMenu.has(item.key))
				.map((item) => (
					<div
						key={item.key}
						className='overflow-controls-item'
						data-overflow-key={item.key}
					>
						{item.node}
					</div>
				))}
			{hidden.length > 0 && (
				<div className='ui-button-group' data-role='plugin-control'>
					<button
						ref={moreRef}
						type='button'
						className={`button ${menuOpen ? 'active' : ''}`}
						data-action='more-controls'
						aria-haspopup='true'
						aria-expanded={menuOpen}
						title={t('More tools')}
						aria-label={t('More tools')}
						onClick={() => setMenuOpen((open) => !open)}
					>
						<MoreHorizontalIcon />
					</button>
				</div>
			)}
			<Popover
				anchor={moreRef.current}
				open={menuOpen && hidden.length > 0}
				className='ui-menu overflow-controls-menu'
				align='end'
				spacing={4}
				padding={8}
				clampHeight
				style={{ zIndex: 'var(--z-dropdown)', width: 'max-content' }}
			>
				<div
					className='ui-panel-header overflow-controls-menu-body'
					data-role='plugin'
				>
					{items
						.filter((item) => inMenu.has(item.key))
						.map((item) => (
							<div key={item.key} className='overflow-controls-item'>
								{item.node}
							</div>
						))}
				</div>
			</Popover>
		</div>
	);
};

export default OverflowControls;
