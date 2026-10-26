// src/extensions/codemirror/CompileDiagnosticsExtension.ts
import {
	type EditorState,
	type Extension,
	RangeSet,
	StateEffect,
	StateField,
} from '@codemirror/state';
import {
	type EditorView,
	GutterMarker,
	gutterLineClass,
	ViewPlugin,
	type ViewUpdate,
} from '@codemirror/view';
import { type Diagnostic, forceLinting, linter } from '@codemirror/lint';

import { t } from '@/i18n';
import {
	type CompileDiagnostic,
	type CompileDiagnosticTarget,
	compileDiagnosticsService,
} from '../../services/CompileDiagnosticsService';

// Marks the lines that the last compile reported, like Overleaf's editor
// annotations: the marks follow the text while it is edited, until the next
// compile replaces them.

export const setCompileDiagnostics = StateEffect.define<Diagnostic[]>();

export const compileDiagnosticsField = StateField.define<Diagnostic[]>({
	create: () => [],
	update(diagnostics, transaction) {
		for (const effect of transaction.effects) {
			if (effect.is(setCompileDiagnostics)) return effect.value;
		}
		if (!transaction.docChanged || diagnostics.length === 0) {
			return diagnostics;
		}

		return diagnostics.map((diagnostic) => {
			const from = transaction.changes.mapPos(diagnostic.from, 1);
			const to = transaction.changes.mapPos(diagnostic.to, -1);
			return { ...diagnostic, from, to: Math.max(from, to) };
		});
	},
});

export function toEditorDiagnostics(
	state: EditorState,
	entries: CompileDiagnostic[],
): Diagnostic[] {
	const { doc } = state;
	return entries.map((entry) => {
		const line = doc.line(Math.min(Math.max(entry.line, 1), doc.lines));
		const indent = line.text.length - line.text.trimStart().length;
		return {
			from: line.from + indent,
			to: line.to,
			severity: entry.severity,
			message: entry.message,
			source: t('Compile log'),
		};
	});
}

class LineMarker extends GutterMarker {
	constructor(readonly elementClass: string) {
		super();
	}
}

const errorLine = new LineMarker('cm-compile-error-line');
const warningLine = new LineMarker('cm-compile-warning-line');

const lineMarkers = gutterLineClass.compute(
	[compileDiagnosticsField],
	(state) => {
		const markers = new Map<number, GutterMarker>();
		for (const diagnostic of state.field(compileDiagnosticsField)) {
			if (diagnostic.severity === 'info') continue;
			const lineStart = state.doc.lineAt(diagnostic.from).from;
			if (diagnostic.severity === 'error') markers.set(lineStart, errorLine);
			else if (!markers.has(lineStart)) markers.set(lineStart, warningLine);
		}
		return RangeSet.of(
			[...markers.entries()]
				.sort(([a], [b]) => a - b)
				.map(([from, marker]) => marker.range(from)),
		);
	},
);

const diagnosticsLoader = (target: CompileDiagnosticTarget) =>
	ViewPlugin.fromClass(
		class {
			// A shared document is still empty until its content arrives.
			private pending = true;
			private destroyed = false;
			private readonly removeListener: () => void;

			constructor(private readonly view: EditorView) {
				this.removeListener = compileDiagnosticsService.addListener(() => {
					this.pending = true;
					this.schedule();
				});
				this.schedule();
			}

			update(update: ViewUpdate) {
				if (this.pending && update.docChanged) this.schedule();
			}

			destroy() {
				this.destroyed = true;
				this.removeListener();
			}

			private schedule() {
				queueMicrotask(() => {
					if (this.destroyed || !this.pending) return;
					if (this.view.state.doc.length === 0) return;

					this.pending = false;
					const entries = compileDiagnosticsService.getForTarget(target);
					if (
						entries.length === 0 &&
						this.view.state.field(compileDiagnosticsField).length === 0
					) {
						return;
					}

					this.view.dispatch({
						effects: setCompileDiagnostics.of(
							toEditorDiagnostics(this.view.state, entries),
						),
					});
					forceLinting(this.view);
				});
			}
		},
	);

export function createCompileDiagnosticsExtension(
	target: CompileDiagnosticTarget,
): Extension {
	if (!target.fileId && !target.documentId) return [];

	return [
		compileDiagnosticsField,
		lineMarkers,
		diagnosticsLoader(target),
		// No delay of its own: it would apply to the other linters too.
		linter((view) => view.state.field(compileDiagnosticsField), {
			needsRefresh: (update) =>
				update.transactions.some((transaction) =>
					transaction.effects.some((effect) =>
						effect.is(setCompileDiagnostics),
					),
				),
		}),
	];
}
