import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import {
	ChevronLeftIcon,
	ChevronRightIcon,
	ExternalLinkIcon,
	XIcon,
} from "lucide-react";
import { type JSX, type KeyboardEvent, useRef } from "react";
import { Button, buttonVariants } from "#dev/components/ui/button.tsx";
import { cn } from "#dev/lib/utils.ts";

/** A control on the dark around the media, in either theme. */
const LIGHT = "text-white hover:bg-white/15 hover:text-white";

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
 * A screenshot or recording at the size of the window over a dimmed page,
 * with its caption, and arrows to the others of its document. Escape, the
 * close button, or a click off the media closes it.
 */
export function Lightbox({
	items,
	index,
	onIndex,
	onClose,
}: {
	items: readonly Shown[];
	/** The one shown, or `null` when the lightbox is closed. */
	index: number | null;
	onIndex: (index: number) => void;
	onClose: () => void;
}): JSX.Element {
	const popup = useRef<HTMLDivElement>(null);
	const shown = index === null ? undefined : items[index];
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
					className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 p-14 text-white outline-none duration-150 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
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
								<img
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
	);
}
