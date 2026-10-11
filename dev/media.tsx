import { Maximize2Icon } from "lucide-react";
import { type JSX, type MouseEvent, useState } from "react";
import { fileUrl } from "./api";
import { ITEM, type Shown, useLightbox } from "./lightbox";

/** The recordings a todo or a task may hold, by extension; `dev.ts` serves them. */
const VIDEO = /\.(mp4|webm|mov)$/i;

/**
 * A markdown image as the screenshot or recording it names, when that is a
 * file arbor holds: an absolute path the server hands back. Anything else,
 * a file elsewhere on the machine or a link off it, reads as its alt text.
 * A click on a screenshot, or on a recording's expand button, opens it in
 * the lightbox among the others of its document.
 */
export function Media({
	src = "",
	alt = "",
}: {
	src?: string;
	alt?: string;
}): JSX.Element {
	const [failed, setFailed] = useState(false);
	const { open: show, lightbox } = useLightbox();
	if (!src.startsWith("/") || failed) {
		return <Alt alt={alt} />;
	}
	const url = fileUrl(src);
	const shown: Shown = { url, alt, video: VIDEO.test(src) };
	const open = (event: MouseEvent<HTMLElement>) => show(event.currentTarget);
	if (shown.video) {
		return (
			<span
				{...{ [ITEM]: JSON.stringify(shown) }}
				className="group/media relative my-2 block w-fit"
			>
				{/* biome-ignore lint/a11y/useMediaCaption: an agent's screen recording has no captions to give */}
				<video
					src={url}
					title={alt}
					controls
					preload="metadata"
					onError={() => setFailed(true)}
					className="block max-h-96 max-w-full rounded-md border"
				/>
				<button
					type="button"
					aria-label={`expand ${alt || "recording"}`}
					onClick={open}
					className="absolute top-2 right-2 flex size-7 cursor-zoom-in items-center justify-center rounded-md bg-black/60 text-white opacity-0 transition-opacity group-hover/media:opacity-100 focus-visible:opacity-100"
				>
					<Maximize2Icon className="size-3.5" />
				</button>
				{lightbox}
			</span>
		);
	}
	return (
		<>
			<button
				type="button"
				{...{ [ITEM]: JSON.stringify(shown) }}
				aria-label={`expand ${alt || "image"}`}
				onClick={open}
				className="my-2 block w-fit max-w-full cursor-zoom-in rounded-md"
			>
				<img
					src={url}
					alt={alt}
					loading="lazy"
					onError={() => setFailed(true)}
					className="block max-h-96 max-w-full rounded-md border"
				/>
			</button>
			{lightbox}
		</>
	);
}

/** An image the page will not load, as its alt text. */
export function Alt({ alt }: { alt?: string }): JSX.Element {
	return <span className="text-muted-foreground">[{alt || "image"}]</span>;
}
