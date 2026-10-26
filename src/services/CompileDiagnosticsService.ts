// src/services/CompileDiagnosticsService.ts
import { createNamedLogger } from '@/logging';
import type { LogDiagnostic } from '../plugins/PluginInterface';
import { pluginRegistry } from '../plugins/PluginRegistry';
import { filePathCacheService } from './FilePathCacheService';

const moduleLog = createNamedLogger('CompileDiagnosticsService');

export interface CompileDiagnostic {
	fileId: string;
	documentId?: string;
	line: number;
	severity: LogDiagnostic['type'];
	message: string;
}

export interface CompileDiagnosticTarget {
	fileId?: string;
	documentId?: string;
}

// Errors and warnings of the last compile, each tied to the project file it
// points to, so that editors can mark their lines as Overleaf does.
class CompileDiagnosticsService {
	private diagnostics: CompileDiagnostic[] = [];
	private listeners: Set<() => void> = new Set();
	private generation = 0;

	async publish(logType: string, log: string, mainFile: string): Promise<void> {
		const generation = ++this.generation;
		const parse = pluginRegistry.getLoggerForType(logType)?.parseDiagnostics;
		const resolved: CompileDiagnostic[] = [];

		try {
			for (const entry of parse?.(log) ?? []) {
				if (!entry.line) continue;

				// Files outside the project, such as packages, are left out.
				const file = await filePathCacheService.findFileByPath(
					mainFile,
					entry.file ?? mainFile,
				);
				if (!file) continue;

				resolved.push({
					fileId: file.id,
					documentId: file.documentId,
					line: entry.line,
					severity: entry.type,
					message: entry.message,
				});
			}
		} catch (error) {
			moduleLog.error('Failed to read compile diagnostics:', error);
		}

		if (generation !== this.generation) return;
		this.diagnostics = resolved;
		this.notifyListeners();
	}

	clear(): void {
		this.generation++;
		this.diagnostics = [];
		this.notifyListeners();
	}

	getForTarget({
		fileId,
		documentId,
	}: CompileDiagnosticTarget): CompileDiagnostic[] {
		return this.diagnostics.filter(
			(entry) =>
				(fileId && entry.fileId === fileId) ||
				(documentId && entry.documentId === documentId),
		);
	}

	addListener(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notifyListeners(): void {
		this.listeners.forEach((listener) => {
			listener();
		});
	}
}

export const compileDiagnosticsService = new CompileDiagnosticsService();
