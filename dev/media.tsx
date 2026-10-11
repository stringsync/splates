import { type JSX, useState } from "react";
import { fileUrl } from "./api";

/** The recordings a todo or a task may hold, by extension; `dev.ts` serves them. */
const VIDEO = /\.(mp4|webm|mov)$/i;

/**
 * A markdown image as the screenshot or recording it names, when that is a
 * file arbor holds: an absolute path the server hands back. Anything else,
 * a file elsewhere on the machine or a link off it, reads as its alt text.
 */
export function Media({
	src = "",
	alt = "",
}: {
	src?: string;
	alt?: string;
}): JSX.Element {
	const [failed, setFailed] = useState(false);
	if (!src.startsWith("/") || failed) {
		return <Alt alt={alt} />;
	}
	const url = fileUrl(src);
	if (VIDEO.test(src)) {
		return (
			// biome-ignore lint/a11y/useMediaCaption: an agent's screen recording has no captions to give
			<video
				src={url}
				title={alt}
				controls
				preload="metadata"
				onError={() => setFailed(true)}
				className="my-2 block max-h-96 max-w-full rounded-md border"
			/>
		);
	}
	return (
		<a href={url} target="_blank" rel="noreferrer" className="block w-fit">
			<img
				src={url}
				alt={alt}
				loading="lazy"
				onError={() => setFailed(true)}
				className="my-2 block max-h-96 max-w-full rounded-md border"
			/>
		</a>
	);
}

/** An image the page will not load, as its alt text. */
export function Alt({ alt }: { alt?: string }): JSX.Element {
	return <span className="text-muted-foreground">[{alt || "image"}]</span>;
}
