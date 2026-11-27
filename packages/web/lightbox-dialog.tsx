import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import {
	ChevronLeftIcon,
	ChevronRightIcon,
	ExternalLinkIcon,
	PencilIcon,
	XIcon,
} from "lucide-react";
import { type JSX, type KeyboardEvent, useRef } from "react";
import { Button, buttonVariants } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import { ZoomableImage } from "#web/zoom.tsx";
import { nameOf, type Shown, useSendBack } from "./lightbox";

/** A control on the dark around the media, in either theme. */
const LIGHT = "text-white hover:bg-white/15 hover:text-white";

/** The visible control is 32px inside a 48px hit area. */
const TOOL = cn(
	LIGHT,
	"pointer-events-auto size-12 border-0 bg-transparent p-0 hover:bg-transparent active:bg-transparent",
	"[&_svg]:box-border [&_svg]:rounded-lg [&_svg]:border [&_svg]:border-[#525457] [&_svg]:bg-[#282a2c] [&_svg]:p-[7px] active:[&_svg]:bg-[#414345]",
);

/** Where an SVG is kept, which cannot be marked up. */
const SVG = /\.svg$/i;

/**
 * Full-screen screenshots and recordings with captions, gallery navigation and
 * markup. On phones, images open enlarged and can be panned or pinched;
 * Fit image shows the overview. Escape or the close button returns to the page.
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
		} else if (
			event.code === "KeyB" &&
			event.metaKey &&
			markable &&
			shown !== undefined
		) {
			// ⌘B marks up, as in the composer.
			event.preventDefault();
			void markUp(shown).catch(() => {});
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
						className={cn(
							"fixed inset-0 z-50 flex flex-col items-center justify-center overflow-hidden text-white outline-none duration-150 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
							shown?.video ? "gap-3 p-14" : "p-0",
						)}
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
										vector={SVG.test(nameOf(shown))}
										className="min-h-0 flex-1"
									/>
								)}
								<div
									className={cn(
										"flex w-full shrink-0 flex-col items-center gap-2 text-sm text-white/80",
										!shown.video &&
											"z-10 px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]",
									)}
								>
									<div className="flex max-w-full items-center gap-3">
										{shown.alt && <span className="truncate">{shown.alt}</span>}
										{many && (
											<span className="shrink-0 tabular-nums text-white/60">
												{(index ?? 0) + 1} of {items.length}
											</span>
										)}
									</div>
									{many && (
										<div className="flex max-w-full items-center gap-2">
											<Button
												variant="ghost"
												size="icon"
												aria-label="previous"
												onClick={() => step(-1)}
												className={cn(TOOL, "shrink-0")}
											>
												<ChevronLeftIcon className="size-8" />
											</Button>
											<Thumbnails
												items={items}
												index={index ?? 0}
												onIndex={onIndex}
											/>
											<Button
												variant="ghost"
												size="icon"
												aria-label="next"
												onClick={() => step(1)}
												className={cn(TOOL, "shrink-0")}
											>
												<ChevronRightIcon className="size-8" />
											</Button>
										</div>
									)}
								</div>
								<div className="pointer-events-none absolute top-[max(0.75rem,env(safe-area-inset-top))] right-[max(0.5rem,env(safe-area-inset-right))] left-[max(0.5rem,env(safe-area-inset-left))] z-10 flex gap-0.5">
									{markable && (
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label="Mark up"
											title="Mark up"
											onClick={() => void markUp(shown).catch(() => {})}
											className={TOOL}
										>
											<PencilIcon className="size-8" />
										</Button>
									)}
									<a
										href={shown.url}
										target="_blank"
										rel="noreferrer"
										aria-label="open in a new tab"
										title="Pop out"
										className={cn(
											buttonVariants({ variant: "ghost", size: "icon-sm" }),
											TOOL,
										)}
									>
										<ExternalLinkIcon className="size-8" />
									</a>
									<DialogPrimitive.Close
										render={
											<Button
												variant="ghost"
												size="icon-sm"
												aria-label="close"
												title="Close"
												className={cn(TOOL, "ml-auto")}
											/>
										}
									>
										<XIcon className="size-8" />
									</DialogPrimitive.Close>
								</div>
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
 * A strip of every item's thumbnail under the one shown, the shown one ringed;
 * clicking one shows it. It scrolls sideways when they outgrow the screen,
 * keeping the shown one in view.
 */
function Thumbnails({
	items,
	index,
	onIndex,
}: {
	items: readonly Shown[];
	index: number;
	onIndex: (index: number) => void;
}): JSX.Element {
	return (
		<div className="flex min-w-0 max-w-full gap-2 overflow-x-auto px-1 py-1">
			{items.map((item, at) => (
				<button
					// The same file may be shown twice in one document.
					// biome-ignore lint/suspicious/noArrayIndexKey: the strip is the document's media in order, which never reorders
					key={at}
					type="button"
					aria-label={`show ${item.alt || (item.video ? "recording" : "image")}`}
					aria-current={at === index}
					ref={(button) => {
						if (at === index) {
							button?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
						}
					}}
					onClick={() => onIndex(at)}
					className={cn(
						"size-13 shrink-0 overflow-hidden rounded-lg border-2 bg-white transition-opacity md:size-16",
						at === index
							? "border-primary opacity-100"
							: "border-transparent opacity-50 hover:opacity-80",
					)}
				>
					{item.video ? (
						<video
							src={item.url}
							preload="metadata"
							muted
							className="size-full object-cover object-top"
						/>
					) : (
						<img
							src={item.url}
							alt=""
							className="size-full object-cover object-top"
						/>
					)}
				</button>
			))}
		</div>
	);
}
