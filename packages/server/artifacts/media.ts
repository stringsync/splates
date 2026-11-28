import { createHash } from "node:crypto";
import { basename, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Fs } from "core/system";
import { MEDIA_TYPES } from "../server/shared";

/** A Markdown image/video reference pointing to a local file on this machine. */
export interface InlineMediaRef {
	/** The raw destination text written inside `(...)` (without outer `<...>`). */
	raw: string;
	/** The resolved absolute path on disk. */
	resolved: string;
	/** The lowercase media extension (`png`, `webm`, ...). */
	ext: string;
}

/** Validated media bytes ready to store in splates-owned storage. */
export interface ValidatedMedia {
	ext: string;
	mimeType: string;
	bytes: Uint8Array;
}

/** Options controlling how Markdown code spans are skipped while scanning. */
export interface InlineMediaScanOptions {
	/**
	 * While an agent is still streaming a chunk, an unclosed inline backtick
	 * on the current line holds back matches after it until the closing
	 * backtick or turn end arrives.
	 */
	streaming?: boolean;
}

/**
 * The validated media type for `path` and `bytes`, or null when the extension
 * is unsupported or the file's magic bytes / structure do not match it.
 */
export function validateMedia(
	path: string,
	bytes: Uint8Array,
): { ext: string; mimeType: string } | null {
	const ext = mediaExtension(path);
	if (ext === null || bytes.length === 0) {
		return null;
	}
	const mimeType = MEDIA_TYPES[ext];
	if (mimeType === undefined) {
		return null;
	}
	return matchesFormat(ext, bytes) ? { ext, mimeType } : null;
}

/**
 * Reads `resolvedPath` if it is a regular file within `maxFileBytes` and its
 * contents match a supported image or video format; null otherwise.
 */
export async function readValidatedMedia(
	fs: Fs,
	resolvedPath: string,
	maxFileBytes: number,
): Promise<ValidatedMedia | null> {
	if (mediaExtension(resolvedPath) === null || maxFileBytes <= 0) {
		return null;
	}
	const stat = await fs.stat(resolvedPath).catch(() => null);
	if (
		stat === null ||
		stat.isDirectory() ||
		stat.size <= 0 ||
		stat.size > maxFileBytes
	) {
		return null;
	}
	const bytes = await fs.readBytes(resolvedPath).catch(() => null);
	if (bytes === null || bytes.length === 0 || bytes.length > maxFileBytes) {
		return null;
	}
	const valid = validateMedia(resolvedPath, bytes);
	return valid === null ? null : { ...valid, bytes };
}

/**
 * Content-addressed filename for a captured media file so repeated references
 * to the same bytes reuse one stored copy without collisions.
 */
export function capturedFileName(
	bytes: Uint8Array,
	sourcePath: string,
): string {
	const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
	const clean = basename(sourcePath).replace(/[^\w.-]+/g, "-") || "media";
	return `${hash}-${clean}`;
}

/**
 * Whether `path` lies inside a conversation's `attached/<bucket>/<file>`
 * directory under `conversationsDir`, with no path traversal.
 */
export function ownsConversationAttached(
	conversationsDir: string,
	path: string,
): boolean {
	const inside = relative(resolve(conversationsDir), resolve(path)).split(sep);
	return (
		!inside.includes("..") &&
		inside.length === 4 &&
		inside[0] !== "" &&
		inside[1] === "attached" &&
		inside[2] !== "" &&
		inside[3] !== ""
	);
}

/**
 * Every Markdown image/video reference outside code blocks in `text` that
 * names a local file with a supported media extension (absolute paths,
 * `file://` URLs, and relative paths when `cwd` is given).
 */
export function findInlineMedia(
	text: string,
	cwd: string | null = null,
	opts: InlineMediaScanOptions = {},
): InlineMediaRef[] {
	return findInlineRefs(text, cwd, mediaExtension, opts);
}

/**
 * Every Markdown embed (`![alt](path)`) outside code blocks in `text` that
 * names a local `.html` or `.htm` file. Plain links (`[alt](path)`) are
 * ignored so code references stay links.
 */
export function findInlineHtml(
	text: string,
	cwd: string | null = null,
	opts: InlineMediaScanOptions = {},
): InlineMediaRef[] {
	return findInlineRefs(text, cwd, htmlExtension, opts);
}

function findInlineRefs(
	text: string,
	cwd: string | null,
	extensionOf: (path: string) => string | null,
	opts: InlineMediaScanOptions,
): InlineMediaRef[] {
	if (!text.includes("![")) {
		return [];
	}
	const found: InlineMediaRef[] = [];
	for (const segment of splitOutsideCode(text, opts.streaming === true)) {
		if (segment.code) {
			continue;
		}
		for (const match of scanImages(segment.text)) {
			const resolved = resolveLocalTarget(match.raw, cwd);
			if (resolved === null) {
				continue;
			}
			const ext = extensionOf(resolved);
			if (ext === null) {
				continue;
			}
			found.push({ raw: match.raw, resolved, ext });
		}
	}
	return found;
}

function htmlExtension(path: string): string | null {
	const name = basename(path);
	const dot = name.lastIndexOf(".");
	if (dot <= 0 || dot === name.length - 1) {
		return null;
	}
	const ext = name.slice(dot + 1).toLowerCase();
	return ext === "html" || ext === "htm" ? ext : null;
}

/**
 * `text` with each Markdown image/video destination outside code blocks that
 * appears in `replacements` rewritten to its stored path, preserving alt text
 * and optional titles.
 */
export function rewriteInlineMedia(
	text: string,
	replacements: ReadonlyMap<string, string>,
	opts: InlineMediaScanOptions = {},
): string {
	if (replacements.size === 0 || !text.includes("![")) {
		return text;
	}
	let changed = false;
	const parts = splitOutsideCode(text, opts.streaming === true).map(
		(segment) => {
			if (segment.code || !segment.text.includes("![")) {
				return segment.text;
			}
			const matches = scanImages(segment.text);
			if (matches.length === 0) {
				return segment.text;
			}
			let out = "";
			let cursor = 0;
			for (const match of matches) {
				const stored = replacements.get(match.raw);
				if (stored === undefined) {
					continue;
				}
				const formatted = formatDestination(stored, match.angled);
				if (segment.text.slice(match.destStart, match.destEnd) === formatted) {
					continue;
				}
				out += segment.text.slice(cursor, match.destStart) + formatted;
				cursor = match.destEnd;
				changed = true;
			}
			return cursor === 0 ? segment.text : out + segment.text.slice(cursor);
		},
	);
	return changed ? parts.join("") : text;
}

/** Lowercase extension of `path` when it is a supported media type, else null. */
export function mediaExtension(path: string): string | null {
	const name = basename(path);
	const dot = name.lastIndexOf(".");
	if (dot <= 0 || dot === name.length - 1) {
		return null;
	}
	const ext = name.slice(dot + 1).toLowerCase();
	return ext in MEDIA_TYPES ? ext : null;
}

/** Resolves a Markdown destination to a local absolute path, or null for remote/invalid targets. */
function resolveLocalTarget(raw: string, cwd: string | null): string | null {
	const target = raw.trim();
	if (target === "" || target.startsWith("#")) {
		return null;
	}
	if (/^file:/i.test(target)) {
		try {
			const url = new URL(target);
			if (
				url.protocol !== "file:" ||
				(url.hostname !== "" && url.hostname !== "localhost")
			) {
				return null;
			}
			return fileURLToPath(url);
		} catch {
			return null;
		}
	}
	// Reject any other URL scheme (http:, https:, data:, blob:, mailto:, etc.).
	if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target)) {
		return null;
	}
	if (target.startsWith("/")) {
		return target;
	}
	if (cwd === null || cwd === "") {
		return null;
	}
	return resolve(cwd, target);
}

/** Formats a stored path for Markdown `(...)`, angle-bracketing if needed. */
function formatDestination(stored: string, wasAngled: boolean): string {
	return wasAngled || /[\s()<>]/.test(stored) ? `<${stored}>` : stored;
}

interface ImageMatch {
	raw: string;
	angled: boolean;
	destStart: number;
	destEnd: number;
}

/** Scans non-code Markdown prose for `![alt](destination [title])` references. */
function scanImages(prose: string): ImageMatch[] {
	const matches: ImageMatch[] = [];
	let i = 0;
	while (i < prose.length) {
		const bang = prose.indexOf("![", i);
		if (bang === -1) {
			break;
		}
		if (isEscaped(prose, bang)) {
			i = bang + 2;
			continue;
		}
		const altEnd = findClosingBracket(prose, bang + 2);
		if (altEnd === -1 || prose[altEnd + 1] !== "(") {
			i = bang + 2;
			continue;
		}
		const parsed = parseDestination(prose, altEnd + 2);
		if (parsed === null) {
			i = altEnd + 2;
			continue;
		}
		matches.push({
			raw: parsed.raw,
			angled: parsed.angled,
			destStart: parsed.destStart,
			destEnd: parsed.destEnd,
		});
		i = parsed.closeParen + 1;
	}
	return matches;
}

/** Finds the `]` closing alt text starting at `start`, honoring `\` escapes and nested `[...]`. */
function findClosingBracket(text: string, start: number): number {
	let depth = 0;
	for (let i = start; i < text.length; i++) {
		const ch = text[i];
		if (ch === "\\" && i + 1 < text.length) {
			i++;
			continue;
		}
		if (ch === "\n") {
			return -1;
		}
		if (ch === "[") {
			depth++;
		} else if (ch === "]") {
			if (depth === 0) {
				return i;
			}
			depth--;
		}
	}
	return -1;
}

/** Parses the destination and optional title inside `(...)` starting right after `(`. */
function parseDestination(
	text: string,
	start: number,
): (ImageMatch & { closeParen: number }) | null {
	let i = start;
	while (i < text.length && (text[i] === " " || text[i] === "\t")) {
		i++;
	}
	if (i >= text.length || text[i] === "\n") {
		return null;
	}
	const destStart = i;
	let raw = "";
	let angled = false;
	let destEnd = i;
	if (text[i] === "<") {
		angled = true;
		i++;
		const innerStart = i;
		while (i < text.length && text[i] !== ">" && text[i] !== "\n") {
			if (text[i] === "\\" && i + 1 < text.length) {
				i += 2;
				continue;
			}
			i++;
		}
		if (i >= text.length || text[i] !== ">") {
			return null;
		}
		raw = text.slice(innerStart, i);
		destEnd = i + 1;
		i++;
	} else {
		let parens = 0;
		while (i < text.length) {
			const ch = text[i];
			if (ch === "\\" && i + 1 < text.length) {
				i += 2;
				continue;
			}
			if (ch === "\n" || ch === " " || ch === "\t") {
				break;
			}
			if (ch === "(") {
				parens++;
			} else if (ch === ")") {
				if (parens === 0) {
					break;
				}
				parens--;
			}
			i++;
		}
		raw = text.slice(destStart, i);
		destEnd = i;
	}
	if (raw.trim() === "") {
		return null;
	}
	// Skip optional whitespace and optional quoted/parenthesized title before `)`.
	while (i < text.length && (text[i] === " " || text[i] === "\t")) {
		i++;
	}
	if (i < text.length && text[i] !== ")") {
		const quote = text[i];
		const close =
			quote === '"' ? '"' : quote === "'" ? "'" : quote === "(" ? ")" : null;
		if (close === null) {
			return null;
		}
		i++;
		while (i < text.length && text[i] !== close && text[i] !== "\n") {
			if (text[i] === "\\" && i + 1 < text.length) {
				i += 2;
				continue;
			}
			i++;
		}
		if (i >= text.length || text[i] !== close) {
			return null;
		}
		i++;
		while (i < text.length && (text[i] === " " || text[i] === "\t")) {
			i++;
		}
	}
	if (i >= text.length || text[i] !== ")") {
		return null;
	}
	return { raw, angled, destStart, destEnd, closeParen: i };
}

function isEscaped(text: string, index: number): boolean {
	let slashes = 0;
	for (let i = index - 1; i >= 0 && text[i] === "\\"; i--) {
		slashes++;
	}
	return slashes % 2 === 1;
}

/** Splits Markdown into code (fenced blocks and inline code spans) and prose segments. */
function splitOutsideCode(
	text: string,
	streaming: boolean,
): { code: boolean; text: string }[] {
	const segments: { code: boolean; text: string }[] = [];
	const push = (code: boolean, chunk: string) => {
		if (chunk === "") {
			return;
		}
		const last = segments.at(-1);
		if (last !== undefined && last.code === code) {
			last.text += chunk;
		} else {
			segments.push({ code, text: chunk });
		}
	};
	const lines = text.split("\n");
	let fenceChar: "`" | "~" | null = null;
	let fenceLen = 0;
	for (let idx = 0; idx < lines.length; idx++) {
		const line = lines[idx] ?? "";
		const suffix = idx < lines.length - 1 ? "\n" : "";
		if (fenceChar !== null) {
			push(true, line + suffix);
			const close = /^[ ]{0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
			if (
				close !== null &&
				close[1]?.[0] === fenceChar &&
				(close[1]?.length ?? 0) >= fenceLen
			) {
				fenceChar = null;
				fenceLen = 0;
			}
			continue;
		}
		const open = /^[ ]{0,3}(`{3,}|~{3,})/.exec(line);
		if (open !== null) {
			const marker = open[1] ?? "";
			const ch = marker[0] as "`" | "~";
			// Backtick info strings cannot contain backticks in CommonMark.
			const info = line.slice(open[0].length);
			if (ch === "~" || !info.includes("`")) {
				fenceChar = ch;
				fenceLen = marker.length;
				push(true, line + suffix);
				continue;
			}
		}
		splitInlineCodeLine(line, streaming && idx === lines.length - 1, push);
		push(false, suffix);
	}
	return segments;
}

/** Splits a single non-fenced line around CommonMark inline backtick code spans. */
function splitInlineCodeLine(
	line: string,
	streamingLine: boolean,
	push: (code: boolean, chunk: string) => void,
): void {
	let i = 0;
	let proseStart = 0;
	while (i < line.length) {
		if (line[i] !== "`") {
			i++;
			continue;
		}
		let runEnd = i;
		while (runEnd < line.length && line[runEnd] === "`") {
			runEnd++;
		}
		const ticks = runEnd - i;
		const closeAt = findClosingTicks(line, runEnd, ticks);
		if (closeAt !== -1) {
			push(false, line.slice(proseStart, i));
			push(true, line.slice(i, closeAt + ticks));
			i = closeAt + ticks;
			proseStart = i;
		} else if (streamingLine) {
			// While still streaming the last line, an unclosed backtick may close
			// in the next chunk, so treat the tail as code for now.
			push(false, line.slice(proseStart, i));
			push(true, line.slice(i));
			return;
		} else {
			i = runEnd;
		}
	}
	push(false, line.slice(proseStart));
}

function findClosingTicks(line: string, start: number, ticks: number): number {
	let i = start;
	while (i < line.length) {
		if (line[i] !== "`") {
			i++;
			continue;
		}
		let end = i;
		while (end < line.length && line[end] === "`") {
			end++;
		}
		if (end - i === ticks) {
			return i;
		}
		i = end;
	}
	return -1;
}

/** Magic-byte and structure verification for every supported media format. */
function matchesFormat(ext: string, bytes: Uint8Array): boolean {
	switch (ext) {
		case "png":
			return (
				bytes.length >= 8 &&
				bytes[0] === 0x89 &&
				bytes[1] === 0x50 &&
				bytes[2] === 0x4e &&
				bytes[3] === 0x47 &&
				bytes[4] === 0x0d &&
				bytes[5] === 0x0a &&
				bytes[6] === 0x1a &&
				bytes[7] === 0x0a
			);
		case "jpg":
		case "jpeg":
			return (
				bytes.length >= 3 &&
				bytes[0] === 0xff &&
				bytes[1] === 0xd8 &&
				bytes[2] === 0xff
			);
		case "gif":
			return (
				bytes.length >= 6 &&
				(asciiAt(bytes, 0, "GIF87a") || asciiAt(bytes, 0, "GIF89a"))
			);
		case "webp":
			return (
				bytes.length >= 12 &&
				asciiAt(bytes, 0, "RIFF") &&
				asciiAt(bytes, 8, "WEBP")
			);
		case "svg":
			return isValidSvg(bytes);
		case "webm":
			return (
				bytes.length >= 4 &&
				bytes[0] === 0x1a &&
				bytes[1] === 0x45 &&
				bytes[2] === 0xdf &&
				bytes[3] === 0xa3
			);
		case "mp4":
			return hasIsoFtypBox(bytes);
		case "mov":
			return hasIsoFtypBox(bytes) || hasQuickTimeAtom(bytes);
		default:
			return false;
	}
}

function asciiAt(bytes: Uint8Array, offset: number, text: string): boolean {
	if (offset + text.length > bytes.length) {
		return false;
	}
	for (let i = 0; i < text.length; i++) {
		if (bytes[offset + i] !== text.charCodeAt(i)) {
			return false;
		}
	}
	return true;
}

function uint32BE(bytes: Uint8Array, offset: number): number {
	return (
		((bytes[offset] ?? 0) * 0x1000000 +
			(((bytes[offset + 1] ?? 0) << 16) |
				((bytes[offset + 2] ?? 0) << 8) |
				(bytes[offset + 3] ?? 0))) >>>
		0
	);
}

/** ISO Base Media File Format `ftyp` box check (MP4 and modern QuickTime MOV). */
function hasIsoFtypBox(bytes: Uint8Array): boolean {
	if (bytes.length < 12 || !asciiAt(bytes, 4, "ftyp")) {
		return false;
	}
	const size = uint32BE(bytes, 0);
	const validSize =
		size === 0 ||
		(size >= 12 && size <= bytes.length) ||
		(size === 1 && bytes.length >= 16);
	if (!validSize) {
		return false;
	}
	// Major brand must be 4 printable ASCII bytes.
	for (let i = 8; i < 12; i++) {
		const byte = bytes[i] ?? 0;
		if (byte < 0x20 || byte > 0x7e) {
			return false;
		}
	}
	return true;
}

const QUICKTIME_ATOMS = ["moov", "mdat", "wide", "free", "skip", "pnot"];

/** Legacy QuickTime `.mov` top-level atom check when no `ftyp` header is present. */
function hasQuickTimeAtom(bytes: Uint8Array): boolean {
	if (bytes.length < 8) {
		return false;
	}
	const size = uint32BE(bytes, 0);
	const validSize =
		size === 0 ||
		(size >= 8 && size <= bytes.length) ||
		(size === 1 && bytes.length >= 16);
	return validSize && QUICKTIME_ATOMS.some((atom) => asciiAt(bytes, 4, atom));
}

/**
 * Verifies `bytes` is valid UTF-8 XML whose root element is `<svg>` (after
 * optional BOM, whitespace, XML prolog, comments, and SVG DOCTYPE).
 */
function isValidSvg(bytes: Uint8Array): boolean {
	for (const byte of bytes) {
		if (byte === 0) {
			return false;
		}
	}
	let text: string;
	try {
		text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		return false;
	}
	let rest = text.replace(/^\uFEFF/, "");
	for (;;) {
		rest = rest.trimStart();
		if (rest.startsWith("<?")) {
			const end = rest.indexOf("?>");
			if (end === -1) {
				return false;
			}
			rest = rest.slice(end + 2);
			continue;
		}
		if (rest.startsWith("<!--")) {
			const end = rest.indexOf("-->");
			if (end === -1) {
				return false;
			}
			rest = rest.slice(end + 3);
			continue;
		}
		const doctype = /^<!DOCTYPE\s+svg\b[^>]*>/i.exec(rest);
		if (doctype !== null) {
			rest = rest.slice(doctype[0].length);
			continue;
		}
		break;
	}
	return /^<svg(?:[\s>/]|$)/i.test(rest);
}
