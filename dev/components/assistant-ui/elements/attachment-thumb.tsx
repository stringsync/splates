import { ITEM, type Shown } from "#dev/lightbox.tsx";

/**
 * How an attachment is shown: an image or a recording in the lightbox, and
 * any other file where it is kept.
 */
type Kind = "image" | "video" | "file";
/** The kind of an attachment of `type` holding `contentType`. */
export const kindOf = (type: string, contentType: string | undefined): Kind =>
	contentType?.startsWith("video/")
		? "video"
		: type === "image" || contentType?.startsWith("image/")
			? "image"
			: "file";
/** What the lightbox shows of an attachment, on the chip that opens it. */
export const shown = (src: string, name: string, kind: Kind) => ({
	[ITEM]: JSON.stringify({
		url: src,
		alt: name,
		video: kind === "video",
	} satisfies Shown),
});
