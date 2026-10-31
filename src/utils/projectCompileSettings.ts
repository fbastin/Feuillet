// src/utils/projectCompileSettings.ts
// The compile settings Overleaf keeps with a project rather than with each
// person: the main document and the compiler.
import type { TypesetterUIField } from '../types/compilation';
import type { ProjectMetadata } from '../types/documents';

type FieldValue = string | number | boolean;

/** A project's value for a field, if it is one the field accepts. */
export function sharedFieldValue(
	metadata: ProjectMetadata | undefined,
	providerId: string,
	field: TypesetterUIField,
): FieldValue | undefined {
	const value = metadata?.typesetterOptions?.[providerId]?.[field.key];
	if (value === undefined || value === null) return undefined;
	switch (field.kind) {
		case 'select':
			return field.options?.some((option) => option.value === value)
				? value
				: undefined;
		case 'boolean':
			return typeof value === 'boolean' ? value : undefined;
		case 'number':
			return typeof value === 'number' ? value : undefined;
		default:
			return typeof value === 'string' ? value : undefined;
	}
}

/** The metadata with a field's value set, or removed when undefined. */
export function withSharedFieldValue(
	metadata: ProjectMetadata,
	providerId: string,
	key: string,
	value: FieldValue | undefined,
): ProjectMetadata {
	const { [key]: _previous, ...others } =
		metadata.typesetterOptions?.[providerId] ?? {};
	const options = value === undefined ? others : { ...others, [key]: value };
	const { [providerId]: _own, ...providers } = metadata.typesetterOptions ?? {};
	const typesetterOptions =
		Object.keys(options).length > 0
			? { ...providers, [providerId]: options }
			: providers;
	const { typesetterOptions: _all, ...rest } = metadata;
	return Object.keys(typesetterOptions).length > 0
		? { ...rest, typesetterOptions }
		: rest;
}

/** The metadata with the main document set, or removed when undefined. */
export function withMainFile(
	metadata: ProjectMetadata,
	mainFile: string | undefined,
): ProjectMetadata {
	const { mainFile: _previous, ...rest } = metadata;
	return mainFile ? { ...rest, mainFile } : rest;
}
