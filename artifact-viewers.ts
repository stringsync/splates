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
