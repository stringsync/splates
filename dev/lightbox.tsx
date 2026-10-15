import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import {
	ChevronLeftIcon,
	ChevronRightIcon,
	ExternalLinkIcon,
	PencilIcon,
	XIcon,
} from "lucide-react";
import {
	type JSX,
	type KeyboardEvent,
	useContext,
	useRef,
	useState,
} from "react";
import { useAnnotate } from "#dev/annotate.tsx";
import { Button, buttonVariants } from "#dev/components/ui/button.tsx";
import { Composing } from "#dev/composing.tsx";
import { cn } from "#dev/lib/utils.ts";
import { ZoomableImage } from "#dev/zoom.tsx";

/** A control on the dark around the media, in either theme. */
const LIGHT = "text-white hover:bg-white/15 hover:text-white";

/** Where an SVG is kept, which cannot be marked up. */
const SVG = /\.svg$/i;

/** One screenshot or recording the lightbox can show. */
export interface Shown {
	/** Where the page loads it from. */
	url: string;
	alt: string;
	video: boolean;
}

/** Marks the media one lightbox steps through: the media of one document. */
export const GROUP = "data-lightbox-group";

/** Marks a screenshot or recording, carrying what the lightbox shows of it. */
export const ITEM = "data-lightbox";

/**
 * Every screenshot and recording in the document `from` sits in, in the order
 * they read, so the lightbox steps through what the reader sees around the
 * one they opened. Outside a document, `from` is shown alone.
 */
export function gallery(from: Element): Shown[] {
	const group = from.closest(`[${GROUP}]`);
	const items = group ? [...group.querySelectorAll(`[${ITEM}]`)] : [from];
	return items.flatMap((item) => {
		const shown = item.getAttribute(ITEM);
		return shown ? [JSON.parse(shown) as Shown] : [];
	});
}

/**
 * A lightbox to render beside the media, and `open`, which shows the media
 * `from` is, or sits in, among the others of its document. Given `markUp`,
 * its Mark up button hands it the image shown, rather than adding a marked
 * up copy to the composer.
 */
export function useLightbox(markUp?: (image: Shown) => Promise<void>): {
	open: (from: Element) => void;
	/** Shows `items[at]`, stepping through `items`. */
	show: (items: Shown[], at: number) => void;
	lightbox: JSX.Element;
} {
	const [items, setItems] = useState<Shown[]>([]);
	const [index, setIndex] = useState<number | null>(null);
	const open = (from: Element) => {
		const item = from.closest(`[${ITEM}]`) ?? from;
		const all = gallery(item);
		const url = (JSON.parse(item.getAttribute(ITEM) ?? "{}") as Partial<Shown>)
			.url;
		setItems(all);
		setIndex(
			Math.max(
				0,
				all.findIndex((item) => item.url === url),
			),
		);
	};
	const show = (items: Shown[], at: number) => {
		setItems(items);
		setIndex(at);
	};
	return {
		open,
		show,
		lightbox: (
			<Lightbox
				items={items}
				index={index}
				onIndex={setIndex}
				onClose={() => setIndex(null)}
				markUp={markUp}
			/>
		),
	};
}

/**
 * A screenshot or recording at the size of the window over a dimmed page,
 * with its caption, and arrows to the others of its document. An image zooms
 * in with a pinch, a double tap or the wheel. Escape, the close button, or a
 * click off the media closes it.
 */
export function Lightbox({
	items,
	index,
	onIndex,
	onClose,
	markUp: markUpThere,
}: {
	items: readonly Shown[];
	/** The one shown, or `null` when the lightbox is closed. */
	index: number | null;
	onIndex: (index: number) => void;
	onClose: () => void;
	/** Marks up the image shown in its own way, as an attachment on its way is. */
	markUp?: ((image: Shown) => Promise<void>) | undefined;
}): JSX.Element {
	const popup = useRef<HTMLDivElement>(null);
	const shown = index === null ? undefined : items[index];
	const sendBack = useSendBack();
	const markable =
		(sendBack.markUp !== null || markUpThere !== undefined) &&
		shown !== undefined &&
		!shown.video &&
		!SVG.test(nameOf(shown));
	const markUp = async (image: Shown) => {
		// Out of the way first: the annotator takes the whole window itself.
		onClose();
		await (markUpThere ?? sendBack.markUp)?.(image);
	};
	const many = items.length > 1;
	const step = (by: number) => {
		if (index !== null && many) {
			onIndex((index + by + items.length) % items.length);
		}
	};
	const onKeyDown = (event: KeyboardEvent) => {
		if (event.key === "ArrowLeft") {
			step(-1);
		} else if (event.key === "ArrowRight") {
			step(1);
		}
	};
	return (
		<>
			<DialogPrimitive.Root
				open={shown !== undefined}
				onOpenChange={(open) => {
					if (!open) {
						onClose();
					}
				}}
			>
				<DialogPrimitive.Portal>
					<DialogPrimitive.Backdrop
						// The task or todo it opens from is often a dialog itself, whose own
						// backdrop would otherwise be the only one shown.
						forceRender
						className="fixed inset-0 z-50 bg-black/85 duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
					/>
					<DialogPrimitive.Popup
						data-slot="lightbox"
						ref={popup}
						// The lightbox itself takes focus, so no control is ringed until
						// the keyboard moves to it.
						initialFocus={popup}
						onKeyDown={onKeyDown}
						// A click on the dimmed space around the media closes it, as a
						// click on the backdrop would: the popup covers the backdrop.
						onClick={(event) => {
							if (event.target === event.currentTarget) {
								onClose();
							}
						}}
						className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 overflow-hidden p-14 text-white outline-none duration-150 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
					>
						{shown && (
							<>
								<DialogPrimitive.Title className="sr-only">
									{shown.alt || (shown.video ? "recording" : "image")}
								</DialogPrimitive.Title>
								{shown.video ? (
									// biome-ignore lint/a11y/useMediaCaption: an agent's screen recording has no captions to give
									<video
										key={shown.url}
										src={shown.url}
										title={shown.alt}
										controls
										autoPlay
										className="min-h-0 max-w-full flex-1 rounded-md object-contain"
									/>
								) : (
									<ZoomableImage
										key={shown.url}
										src={shown.url}
										alt={shown.alt}
										className="min-h-0 max-w-full rounded-md object-contain"
									/>
								)}
								<div className="flex max-w-full items-center gap-3 text-sm text-white/80">
									{shown.alt && <span className="truncate">{shown.alt}</span>}
									{many && (
										<span className="shrink-0 tabular-nums text-white/60">
											{(index ?? 0) + 1} of {items.length}
										</span>
									)}
								</div>
								<div className="absolute top-3 right-3 flex gap-1">
									{markable && (
										<Button
											variant="ghost"
											size="sm"
											onClick={() => void markUp(shown).catch(() => {})}
											className={LIGHT}
										>
											<PencilIcon />
											Mark up
										</Button>
									)}
									<a
										href={shown.url}
										target="_blank"
										rel="noreferrer"
										aria-label="open in a new tab"
										className={cn(
											buttonVariants({ variant: "ghost", size: "icon-sm" }),
											LIGHT,
										)}
									>
										<ExternalLinkIcon />
									</a>
									<DialogPrimitive.Close
										render={
											<Button
												variant="ghost"
												size="icon-sm"
												aria-label="close"
												className={LIGHT}
											/>
										}
									>
										<XIcon />
									</DialogPrimitive.Close>
								</div>
								{many && (
									<>
										<Button
											variant="ghost"
											size="icon"
											aria-label="previous"
											onClick={() => step(-1)}
											className={cn(
												"absolute top-1/2 left-2 -translate-y-1/2",
												LIGHT,
											)}
										>
											<ChevronLeftIcon />
										</Button>
										<Button
											variant="ghost"
											size="icon"
											aria-label="next"
											onClick={() => step(1)}
											className={cn(
												"absolute top-1/2 right-2 -translate-y-1/2",
												LIGHT,
											)}
										>
											<ChevronRightIcon />
										</Button>
									</>
								)}
							</>
						)}
					</DialogPrimitive.Popup>
				</DialogPrimitive.Portal>
			</DialogPrimitive.Root>
			{sendBack.annotate}
		</>
	);
}

/**
 * Marks up an image in a conversation and adds it to the composer, to go back
 * to the agent; `markUp` is null where no conversation is open. Render
 * `annotate` beside whatever calls it.
 */
export function useSendBack(): {
	markUp: ((image: Shown) => Promise<void>) | null;
	annotate: JSX.Element;
} {
	const composer = useContext(Composing);
	const annotator = useAnnotate();
	const markUp = async (image: Shown) => {
		const response = await fetch(image.url);
		const blob = await response.blob();
		const marked = await annotator.open(
			new File([blob], nameOf(image), { type: blob.type }),
		);
		await composer?.addAttachment(marked);
	};
	return {
		markUp: composer === null ? null : markUp,
		annotate: annotator.annotate,
	};
}

/**
 * A file name for `image`, from where it is kept: the file a `/api/file` link
 * reads, or the link's own last step.
 */
function nameOf(image: Shown): string {
	const [link = "", query = ""] = image.url.split("?");
	const path = new URLSearchParams(query).get("path") ?? link;
	// Less the id arbor keeps an attached file under.
	const last = (path.split("/").pop() ?? "").replace(/^[0-9a-f-]{36}-/, "");
	return /\.\w+$/.test(last) ? last : "image.png";
}
