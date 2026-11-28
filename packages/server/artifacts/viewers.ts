/**
 * How the page shows an artifact of `mimeType`: an image or a recording in
 * the lightbox, a page in a sandboxed frame, or null for one it only offers
 * as a download, which the server sends as an attachment to match.
 */
export function viewerOf(mimeType: string): "image" | "video" | "page" | null {
	if (/^image\//i.test(mimeType)) {
		return "image";
	}
	if (/^video\//i.test(mimeType)) {
		return "video";
	}
	if (/^(text\/html|application\/xhtml\+xml)\b/i.test(mimeType)) {
		return "page";
	}
	return null;
}

/** Whether `name` has an HTML file extension (`.html` or `.htm`). */
export function isHtmlArtifactName(name: string): boolean {
	return /\.html?$/i.test(name.trim());
}

/** Fragment prefix used when auto-captured HTML embeds are rewritten in replies. */
const INLINE_ARTIFACT_PREFIX = "#splates-artifact=";

/**
 * Formats an inline Markdown destination referring to `version` of artifact
 * `name` in the current conversation.
 */
export function formatInlineArtifactRef(name: string, version: number): string {
	return `${INLINE_ARTIFACT_PREFIX}${encodeURIComponent(name)}/${version}`;
}

/**
 * Parses an inline artifact destination written by `formatInlineArtifactRef`,
 * or returns null for any other URL or path.
 */
export function parseInlineArtifactRef(
	src: string,
): { name: string; version: number } | null {
	if (!src.startsWith(INLINE_ARTIFACT_PREFIX)) {
		return null;
	}
	const rest = src.slice(INLINE_ARTIFACT_PREFIX.length);
	const slash = rest.lastIndexOf("/");
	if (slash <= 0) {
		return null;
	}
	const version = Number(rest.slice(slash + 1));
	if (!Number.isInteger(version) || version < 1) {
		return null;
	}
	try {
		const name = decodeURIComponent(rest.slice(0, slash));
		return name === "" ? null : { name, version };
	} catch {
		return null;
	}
}
