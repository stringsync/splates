import { ChevronRightIcon, ImageIcon, Maximize2Icon } from "lucide-react";
import { type JSX, type MouseEvent, useState } from "react";
import { fileUrl } from "./api";
import { ITEM, type Shown, useLightbox } from "./lightbox";

/** The recordings a todo or a task may hold, by extension; `dev.ts` serves them. */
const VIDEO = /\.(mp4|webm|mov)$/i;

/**
 * Shows an attached screenshot or recording. Pass its stored absolute path
 * and a caption; click it to explore the document's media in the lightbox.
 * An unavailable attachment shows instructions for repairing its delivery.
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
	if (failed && src.startsWith("/")) {
		return (
			<span role="status" className="text-muted-foreground">
				[{alt || "image"}: unavailable. Ask the agent to run splates attach with
				the original file and paste the returned image Markdown.]
			</span>
		);
	}
	if (!src.startsWith("/")) {
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
				className="group/image relative my-2 block w-fit max-w-full cursor-zoom-in overflow-hidden rounded-md max-md:w-full"
			>
				<img
					src={url}
					alt={alt}
					loading="lazy"
					onError={() => setFailed(true)}
					className="block max-h-96 max-w-full rounded-md border max-md:h-36 max-md:w-full max-md:object-cover max-md:object-top"
				/>
				{/* On desktop a corner icon on hover says the image opens, as a recording's does. */}
				<span className="absolute top-2 right-2 flex size-7 items-center justify-center rounded-md bg-black/60 text-white opacity-0 transition-opacity group-hover/image:opacity-100 group-focus-visible/image:opacity-100 max-md:hidden">
					<Maximize2Icon className="size-3.5" />
				</span>
				{/* On a phone the image is a cropped preview, so a footer names it and says it opens. */}
				<span className="absolute inset-x-0 bottom-0 hidden items-center gap-2.5 border-border/70 border-t bg-card/95 px-3 py-2 text-card-foreground max-md:flex">
					<ImageIcon className="size-4 shrink-0 text-muted-foreground" />
					<span className="min-w-0 flex-1 truncate text-left text-[13px]">
						{alt || "Image"}
					</span>
					<span className="flex shrink-0 items-center gap-0.5 font-medium text-xs">
						Open image
						<ChevronRightIcon className="size-3.5" />
					</span>
				</span>
			</button>
			{lightbox}
		</>
	);
}

/** An image the page will not load, as its alt text. */
export function Alt({ alt }: { alt?: string }): JSX.Element {
	return <span className="text-muted-foreground">[{alt || "image"}]</span>;
}
