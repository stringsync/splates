/** Maximum length kept for a page's `<title>` when displayed in the thread. */
const MAX_TITLE = 120;

/**
 * The text inside `<title>...</title>` of an HTML document, collapsed to one
 * line with common entities decoded, or null when absent or empty.
 */
export function htmlTitleOf(bytes: Uint8Array): string | null {
	const text = decodeUtf8(bytes);
	if (text === null) {
		return null;
	}
	const match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(text);
	if (match === null) {
		return null;
	}
	const decoded = decodeEntities(match[1] ?? "")
		.replace(/\s+/g, " ")
		.trim();
	if (decoded === "") {
		return null;
	}
	return decoded.length > MAX_TITLE
		? `${decoded.slice(0, MAX_TITLE - 1).trimEnd()}…`
		: decoded;
}

/**
 * Whether `bytes` is valid UTF-8 HTML suitable for capturing as an HTML
 * artifact (non-empty, no NUL bytes, and contains recognizable HTML markup).
 */
export function isValidHtml(bytes: Uint8Array): boolean {
	if (bytes.length === 0) {
		return false;
	}
	const text = decodeUtf8(bytes);
	if (text === null) {
		return false;
	}
	const trimmed = text.replace(/^\uFEFF/, "").trimStart();
	return (
		/^<!doctype\s+html\b/i.test(trimmed) ||
		/<(?:html|head|body|main|section|article|div|table|svg|h[1-6]|p|style|script)\b/i.test(
			trimmed,
		)
	);
}

/**
 * External script, stylesheet, and image references in an HTML document that
 * the sandboxed artifact CSP (`default-src data: 'unsafe-inline'; connect-src
 * 'none'`) will block from loading.
 */
export function externalHtmlRefs(bytes: Uint8Array): string[] {
	const text = decodeUtf8(bytes);
	if (text === null) {
		return [];
	}
	const found = new Set<string>();
	for (const match of text.matchAll(
		/<script\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
	)) {
		const ref = (match[1] ?? match[2] ?? match[3] ?? "").trim();
		if (isBlockedRef(ref)) {
			found.add(ref);
		}
	}
	for (const match of text.matchAll(/<link\b[^>]*>/gi)) {
		const tag = match[0];
		if (
			!/\brel\s*=\s*(?:"[^"]*\bstylesheet\b[^"]*"|'[^']*\bstylesheet\b[^']*'|stylesheet\b)/i.test(
				tag,
			)
		) {
			continue;
		}
		const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
		const ref = (href?.[1] ?? href?.[2] ?? href?.[3] ?? "").trim();
		if (isBlockedRef(ref)) {
			found.add(ref);
		}
	}
	for (const match of text.matchAll(
		/<img\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
	)) {
		const ref = (match[1] ?? match[2] ?? match[3] ?? "").trim();
		if (isBlockedRef(ref)) {
			found.add(ref);
		}
	}
	return [...found];
}

function isBlockedRef(ref: string): boolean {
	if (ref === "" || ref.startsWith("#")) {
		return false;
	}
	return !/^(?:data|blob):/i.test(ref);
}

function decodeUtf8(bytes: Uint8Array): string | null {
	for (const byte of bytes) {
		if (byte === 0) {
			return null;
		}
	}
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		return null;
	}
}

function decodeEntities(text: string): string {
	return text.replace(
		/&(?:#(\d+)|#x([0-9a-fA-F]+)|([a-zA-Z]+));/g,
		(
			whole,
			dec: string | undefined,
			hex: string | undefined,
			named: string | undefined,
		) => {
			if (dec !== undefined) {
				const code = Number.parseInt(dec, 10);
				return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
			}
			if (hex !== undefined) {
				const code = Number.parseInt(hex, 16);
				return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
			}
			switch (named) {
				case "amp":
					return "&";
				case "lt":
					return "<";
				case "gt":
					return ">";
				case "quot":
					return '"';
				case "apos":
					return "'";
				case "nbsp":
					return " ";
				default:
					return whole;
			}
		},
	);
}
