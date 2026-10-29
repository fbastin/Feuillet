// src/utils/latexSynctexParser.ts
import { inflate } from 'pako';

import type {
	SourceMapData,
	SourceMapForwardResult,
	SourceMapReverseResult,
} from '../types/sourceMap';

// SyncTeX counts in TeX's scaled points; PDF pages in big points.
const SP_TO_PT = 72 / 72.27 / 65536;
const CONTAINER_HEIGHT_LINE_MULTIPLE = 16;
const FALLBACK_VERTICAL_LINE_TOLERANCE = 1.5;

interface Box {
	page: number;
	file: string;
	line: number;
	column: number;
	x: number;
	y: number;
	width: number;
	height: number;
	depth: number;
	isVbox: boolean;
	// What the box holds that TeX read from the source: the lines of a
	// paragraph are boxed where it ends, but their words where they were.
	points: Point[];
}

// A kern, glue, math or boundary node, with the line it was read on.
interface Point {
	page: number;
	file: string;
	line: number;
	column: number;
	x: number;
	box: Box | null;
	// Boundaries mark where a box starts or ends, with the box's own line.
	isBoundary: boolean;
}

interface Index {
	byFileLine: Map<string, Box[]>;
	byPage: Map<number, Box[]>;
	pointsByFileLine: Map<string, Point[]>;
}

const decode = (bytes: Uint8Array): string => {
	const gzip = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
	return new TextDecoder('utf-8').decode(gzip ? inflate(bytes) : bytes);
};

const normalize = (file: string): string =>
	file.replace(/^\.?\/+/, '').replace(/^_+/, '');

const parseRecord = (
	line: string,
): {
	tag: number;
	line: number;
	column: number;
	x: number;
	y: number;
	width: number;
	height: number;
	depth: number;
} | null => {
	const colon = line.indexOf(':');
	if (colon === -1) return null;

	const prefix = line.substring(1, colon).split(',');
	const tag = Number.parseInt(prefix[0], 10);
	const lineNum = Number.parseInt(prefix[1], 10);
	if (Number.isNaN(tag) || Number.isNaN(lineNum)) return null;

	const rest = line.substring(colon + 1).split(/[,:]/);
	const x = Number.parseInt(rest[0], 10);
	const y = Number.parseInt(rest[1], 10);
	if (Number.isNaN(x) || Number.isNaN(y)) return null;

	return {
		tag,
		line: lineNum,
		column: prefix.length > 2 ? Number.parseInt(prefix[2], 10) : -1,
		x,
		y,
		width: Number.parseInt(rest[2], 10) || 0,
		height: Number.parseInt(rest[3], 10) || 0,
		depth: Number.parseInt(rest[4], 10) || 0,
	};
};

const buildIndex = (text: string): Index => {
	const inputs = new Map<number, string>();
	const byFileLine = new Map<string, Box[]>();
	const byPage = new Map<number, Box[]>();
	const pointsByFileLine = new Map<string, Point[]>();
	// The boxes open around the current record; null for one not kept.
	let open: (Box | null)[] = [];
	let page = 0;
	let inContent = false;
	let rootPrefix = '';

	const toRootRelative = (file: string): string => {
		const path = file.replace(/\/\.\//g, '/');
		return rootPrefix && path.startsWith(rootPrefix)
			? path.substring(rootPrefix.length)
			: path;
	};

	for (const raw of text.split('\n')) {
		if (!raw) continue;

		if (raw.startsWith('Input:')) {
			const parts = raw.substring(6).split(':');
			const tag = Number.parseInt(parts[0], 10);
			if (parts.length >= 2 && !Number.isNaN(tag)) {
				inputs.set(tag, parts.slice(1).join(':').trim());
			}
			continue;
		}

		if (!inContent) {
			if (raw === 'Content:') {
				inContent = true;
				const main = (inputs.get(1) ?? '').replace(/\/\.\//g, '/');
				rootPrefix = main.substring(0, main.lastIndexOf('/') + 1);
			}
			continue;
		}

		if (raw.startsWith('Postamble:')) break;

		const kind = raw[0];

		if (kind === '{') {
			const n = Number.parseInt(raw.substring(1), 10);
			if (!Number.isNaN(n)) {
				page = n;
				open = [];
				if (!byPage.has(page)) byPage.set(page, []);
			}
			continue;
		}

		if (kind === '}') {
			page = 0;
			open = [];
			continue;
		}

		if (kind === ')' || kind === ']') {
			open.pop();
			continue;
		}

		const isPoint =
			kind === 'x' || kind === 'k' || kind === 'g' || kind === '$';
		if (
			!isPoint &&
			kind !== 'h' &&
			kind !== '[' &&
			kind !== '(' &&
			kind !== 'r'
		) {
			continue;
		}

		const fields = parseRecord(raw);
		if (!fields) {
			if (kind === '(' || kind === '[') open.push(null);
			continue;
		}

		const input = inputs.get(fields.tag);
		if (!input || page === 0) {
			if (kind === '(' || kind === '[') open.push(null);
			continue;
		}

		const file = toRootRelative(input);

		const key = `${file}:${fields.line}`;

		if (isPoint) {
			let box: Box | null = null;
			for (let i = open.length - 1; i >= 0 && !box; i--) {
				const enclosing = open[i];
				if (enclosing && !enclosing.isVbox) box = enclosing;
			}
			const point: Point = {
				page,
				file,
				line: fields.line,
				column: fields.column,
				x: fields.x * SP_TO_PT,
				box,
				isBoundary: kind === 'x',
			};
			box?.points.push(point);
			const points = pointsByFileLine.get(key);
			if (points) points.push(point);
			else pointsByFileLine.set(key, [point]);
			continue;
		}

		if (kind === 'r') {
			const list = byFileLine.get(key);
			const last = list?.[list.length - 1];
			if (last && last.width === 0) {
				last.width = fields.width * SP_TO_PT;
				if (last.height === 0) last.height = fields.height * SP_TO_PT;
				if (last.depth === 0) last.depth = fields.depth * SP_TO_PT;
			}
			continue;
		}

		const box: Box = {
			page,
			file,
			line: fields.line,
			column: fields.column,
			x: fields.x * SP_TO_PT,
			y: fields.y * SP_TO_PT,
			width: fields.width * SP_TO_PT,
			height: fields.height * SP_TO_PT,
			depth: fields.depth * SP_TO_PT,
			isVbox: kind === '[',
			points: [],
		};

		const list = byFileLine.get(key);
		if (list) list.push(box);
		else byFileLine.set(key, [box]);

		byPage.get(page)?.push(box);
		if (kind === '(' || kind === '[') open.push(box);
	}

	return { byFileLine, byPage, pointsByFileLine };
};

export function parseSynctex(bytes: Uint8Array): SourceMapData {
	const index = buildIndex(decode(bytes));

	return {
		forward(file: string, line: number): SourceMapForwardResult | null {
			const target = normalize(file);
			const targetBase = target.split('/').pop() ?? '';

			const rankFile = (indexed: string): number => {
				const n = normalize(indexed);
				if (n === target) return 0;
				if (n.endsWith(`/${target}`) || target.endsWith(`/${n}`)) return 1;
				if (targetBase && n.split('/').pop() === targetBase) return 2;
				return Number.POSITIVE_INFINITY;
			};

			let bestRank = Number.POSITIVE_INFINITY;
			for (const key of index.byFileLine.keys()) {
				bestRank = Math.min(
					bestRank,
					rankFile(key.substring(0, key.lastIndexOf(':'))),
				);
			}
			if (bestRank === Number.POSITIVE_INFINITY) return null;

			// The lines holding what TeX read on that line, as the synctex tool
			// shows them, rather than the boxes made there: a paragraph's lines
			// are made where it ends.
			const holding: Box[] = [];
			for (const [key, points] of index.pointsByFileLine) {
				const colon = key.lastIndexOf(':');
				if (Number.parseInt(key.substring(colon + 1), 10) !== line) continue;
				if (rankFile(key.substring(0, colon)) !== bestRank) continue;
				for (const point of points) {
					const box = point.box;
					if (!point.isBoundary && box && box.width > 0) {
						if (!holding.includes(box)) holding.push(box);
					}
				}
			}
			if (holding.length > 0) {
				const page = holding[0].page;
				return {
					page,
					rects: holding
						.filter((b) => b.page === page)
						.map((b) => ({
							x: b.x,
							y: b.y - b.height,
							width: b.width,
							height: b.height + b.depth,
						})),
				};
			}

			let exact: Box[] = [];
			let nearest: Box[] = [];
			let nearestDelta = Number.POSITIVE_INFINITY;

			for (const [key, boxes] of index.byFileLine) {
				const colon = key.lastIndexOf(':');
				if (rankFile(key.substring(0, colon)) !== bestRank) continue;

				const blockLine = Number.parseInt(key.substring(colon + 1), 10);
				if (blockLine === line) {
					exact = exact.concat(boxes);
					continue;
				}

				const delta = Math.abs(blockLine - line);
				if (delta < nearestDelta) {
					nearestDelta = delta;
					nearest = boxes.slice();
				} else if (delta === nearestDelta) {
					nearest = nearest.concat(boxes);
				}
			}

			const candidates = exact.length > 0 ? exact : nearest;
			if (candidates.length === 0) return null;

			const page = candidates[0].page;
			const onPage = candidates.filter((b) => b.page === page && b.width > 0);
			if (onPage.length === 0) return null;

			const rects = onPage.map((b) => ({
				x: b.x,
				y: b.y - b.height,
				width: b.width,
				height: b.height + b.depth,
			}));

			return { page, rects };
		},

		reverse(page: number, x: number, y: number): SourceMapReverseResult | null {
			const boxes = index.byPage.get(page);
			if (!boxes?.length) return null;

			const lineHeights = boxes
				.filter((b) => !b.isVbox && b.height + b.depth > 0)
				.map((b) => b.height + b.depth)
				.sort((a, b) => a - b);
			const medianLineHeight = lineHeights.length
				? lineHeights[Math.floor(lineHeights.length / 2)]
				: 0;
			const maxBoxHeight =
				medianLineHeight > 0
					? medianLineHeight * CONTAINER_HEIGHT_LINE_MULTIPLE
					: Number.POSITIVE_INFINITY;

			const selectBox = (applyCap: boolean): Box | null => {
				let bestContained: Box | null = null;
				let bestScore = Number.POSITIVE_INFINITY;
				let closest: Box | null = null;
				let closestDist = Number.POSITIVE_INFINITY;

				for (const b of boxes) {
					const boxHeight = b.height + b.depth;
					if (applyCap && boxHeight > maxBoxHeight) continue;

					const top = b.y - b.height;
					const bottom = b.y + b.depth;
					const right = b.x + b.width;

					if (x >= b.x && x <= right && y >= top && y <= bottom) {
						const cx = b.x + b.width / 2;
						const cy = (top + bottom) / 2;
						const dx = x - cx;
						const dy = y - cy;
						const area = b.width * (boxHeight || 1) || 1;
						const score = (dx * dx + dy * dy) * Math.sqrt(area);
						if (bestContained === null || score < bestScore) {
							bestScore = score;
							bestContained = b;
						}
					} else if (applyCap) {
						const cx = Math.max(b.x, Math.min(x, right));
						const cy = Math.max(top, Math.min(y, bottom));
						const dx = x - cx;
						const dy = y - cy;
						const lineHeight = boxHeight || 1;
						if (Math.abs(dy) > lineHeight * FALLBACK_VERTICAL_LINE_TOLERANCE)
							continue;
						const dist = dx * dx + dy * dy;
						if (dist < closestDist) {
							closestDist = dist;
							closest = b;
						}
					}
				}

				return bestContained ?? closest;
			};

			const hit = selectBox(true) ?? selectBox(false);
			if (!hit) return null;

			// In a line, the node nearest the click says where TeX read it.
			const words = hit.points.filter((point) => !point.isBoundary);
			let nearestPoint: Point | null = null;
			for (const point of words.length > 0 ? words : hit.points) {
				if (
					!nearestPoint ||
					Math.abs(point.x - x) < Math.abs(nearestPoint.x - x)
				) {
					nearestPoint = point;
				}
			}
			if (nearestPoint) {
				return {
					file: nearestPoint.file,
					line: nearestPoint.line,
					column: nearestPoint.column >= 0 ? nearestPoint.column : undefined,
				};
			}

			const line = hit.isVbox ? Math.max(1, hit.line - 1) : hit.line;

			return {
				file: hit.file,
				line,
				column: hit.column >= 0 ? hit.column : undefined,
			};
		},
	};
}
