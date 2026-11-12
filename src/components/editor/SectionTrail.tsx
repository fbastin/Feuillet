// src/components/editor/SectionTrail.tsx
// Where the cursor is in the document's outline, after the file's path, as
// Overleaf's breadcrumbs: /main.tex › Méthodes › Données. Each part goes to
// its heading. LaTeX's parts, chapters, sections…; Typst's headings.
import type { EditorView } from '@codemirror/view';
import React, { useCallback, useEffect, useState } from 'react';

import { t } from '@/i18n';
import { isLatexFile, isTypstFile } from '../../utils/fileUtils';
import { LaTeXOutlineParser } from '../../utils/latexOutlineParser';
import { TypstOutlineParser } from '../../utils/typstOutlineParser';

interface Heading {
	title: string;
	line: number;
	children: Heading[];
}

/** The headings `line` is under, the outermost first. */
export function headingTrail(
	sections: readonly Heading[],
	line: number,
): Heading[] {
	const trail: Heading[] = [];
	let level = sections;
	for (;;) {
		let found: Heading | undefined;
		for (const section of level) {
			if (section.line > line) break;
			found = section;
		}
		if (!found) return trail;
		trail.push(found);
		level = found.children;
	}
}

type OutlineKind = 'latex' | 'typst';

/** The trail at a line, from the text up to that line's end. */
export const trailAt = (
	text: string,
	line: number,
	kind: OutlineKind,
): { title: string; line: number }[] =>
	headingTrail(
		kind === 'latex'
			? LaTeXOutlineParser.parse(text)
			: TypstOutlineParser.parse(text),
		line,
	).map(({ title, line: at }) => ({ title, line: at }));

interface SectionTrailProps {
	viewRef: React.RefObject<EditorView | null>;
	fileName?: string;
}

const SectionTrail: React.FC<SectionTrailProps> = ({ viewRef, fileName }) => {
	const kind: OutlineKind | null = isLatexFile(fileName)
		? 'latex'
		: isTypstFile(fileName)
			? 'typst'
			: null;
	const [trail, setTrail] = useState<{ title: string; line: number }[]>([]);

	useEffect(() => {
		setTrail([]);
		if (!kind) return;
		const update = () => {
			const view = viewRef.current;
			if (!view) return;
			const { doc, selection } = view.state;
			const line = doc.lineAt(selection.main.head);
			// Only the headings before the cursor can hold it.
			const next = trailAt(doc.sliceString(0, line.to), line.number, kind);
			setTrail((current) =>
				current.length === next.length &&
				current.every(
					(heading, i) =>
						heading.line === next[i].line && heading.title === next[i].title,
				)
					? current
					: next,
			);
		};
		// The editor (re)made for this file: once it is there.
		const first = window.setTimeout(update, 300);
		document.addEventListener('editor-cursor-update', update);
		return () => {
			window.clearTimeout(first);
			document.removeEventListener('editor-cursor-update', update);
		};
	}, [kind, viewRef]);

	const goTo = useCallback(
		(line: number) => {
			const view = viewRef.current;
			if (!view) return;
			const { doc } = view.state;
			const at = doc.line(Math.min(line, doc.lines)).from;
			view.dispatch({ selection: { anchor: at }, scrollIntoView: true });
			view.focus();
		},
		[viewRef],
	);

	if (trail.length === 0) return null;
	return (
		<nav
			className='section-trail'
			data-role='section-trail'
			aria-label={t('Position in the outline')}
		>
			{trail.map((heading) => (
				<React.Fragment key={heading.line}>
					<span className='section-trail-separator' aria-hidden='true'>
						›
					</span>
					<button
						type='button'
						className='section-trail-item'
						title={t('Go to « {title} »', { title: heading.title })}
						onClick={() => goTo(heading.line)}
					>
						{heading.title}
					</button>
				</React.Fragment>
			))}
		</nav>
	);
};

export default SectionTrail;
