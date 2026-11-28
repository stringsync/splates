import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import {
	AppWindowIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	ExternalLinkIcon,
	Maximize2Icon,
	Minimize2Icon,
	PencilIcon,
	ShieldCheckIcon,
} from "lucide-react";
import {
	type JSX,
	type KeyboardEvent,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { Button, buttonVariants } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import { type FitControl, ZoomableImage } from "#web/zoom.tsx";
import {
	AnnotateContent,
	handleAnnotateKeyDown,
	useAnnotatePopupStyle,
} from "./annotate-board";
import { Annotation } from "./annotation";
import { answered, WAITS } from "./api";
import { Composing } from "./composing";
import { type MarkUpInPlace, nameOf, type Shown } from "./lightbox";
import {
	LIGHTBOX_ACTION,
	LIGHTBOX_BACKDROP_CLASS,
	LIGHTBOX_MOBILE_TOOL,
	LIGHTBOX_POPUP_CLASS,
	LightboxHeader,
	useNarrow,
} from "./lightbox-shell";

/** Where an SVG is kept, which cannot be marked up. */
const SVG = /\.svg$/i;

/**
 * Unified full-screen viewer for images, recordings, HTML previews, and
 * in-place image markup. Shares one dark shell and top bar (Close always
 * top-right, Fit width/all in the top bar for tall images), switches into
 * markup in place without swapping dialogs, and closes HTML previews on
 * Escape even when focus is inside the sandboxed frame.
 */
export function Lightbox({
	items,
	index,
	onIndex,
	onClose,
	markUp: markUpInPlace,
}: {
	items: readonly Shown[];
	/** The one shown, or `null` when the lightbox is closed. */
	index: number | null;
	onIndex: (index: number) => void;
	onClose: () => void;
	/** Marks up the image in place with a custom loader/saver (e.g. composer attachment). */
	markUp?: MarkUpInPlace | undefined;
}): JSX.Element {
	const popup = useRef<HTMLDivElement>(null);
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const composer = useContext(Composing);
	const shown = index === null ? undefined : items[index];
	const [fitControl, setFitControl] = useState<FitControl | null>(null);
	const [editing, setEditing] = useState<Annotation | null>(null);
	const editingRef = useRef<Annotation | null>(null);
	editingRef.current = editing;
	const openingMarkUp = useRef(false);
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;

	// Release decoded bitmap when editing ends or unmounts.
	useEffect(() => () => editing?.dispose(), [editing]);

	// Close HTML preview when the sandboxed iframe forwards an unconsumed Escape.
	useEffect(() => {
		if (!shown?.html || editing !== null) {
			return;
		}
		const onMessage = (event: MessageEvent) => {
			if (event.source !== iframeRef.current?.contentWindow) {
				return;
			}
			const data = event.data as { splates?: unknown } | null;
			if (data?.splates === "escape") {
				onCloseRef.current();
			}
		};
		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, [shown?.html, editing]);

	const narrow = useNarrow();
	const annotateStyle = useAnnotatePopupStyle();
	const markable =
		(composer !== null || markUpInPlace !== undefined) &&
		shown !== undefined &&
		!shown.video &&
		!shown.html &&
		!SVG.test(nameOf(shown));

	const startMarkUp = async (image: Shown) => {
		if (openingMarkUp.current || editingRef.current !== null) {
			return;
		}
		openingMarkUp.current = true;
		try {
			let file: File | null;
			if (markUpInPlace !== undefined) {
				file = await markUpInPlace.load(image);
			} else {
				const response = await answered(image.url, { within: WAITS.upload });
				const blob = await response.blob();
				file = new File([blob], nameOf(image), { type: blob.type });
			}
			if (file === null) {
				return;
			}
			const opened = await Annotation.open(file);
			setFitControl(null);
			setEditing(opened);
		} finally {
			openingMarkUp.current = false;
		}
	};

	const finishMarkUp = async () => {
		const active = editingRef.current;
		if (active === null) {
			return;
		}
		const marked = await active.flatten().catch(() => active.original);
		setEditing(null);
		onClose();
		if (marked !== active.original) {
			if (markUpInPlace !== undefined) {
				await markUpInPlace.save(marked, active.original);
			} else {
				await composer?.addAttachment(marked);
			}
		}
	};

	const many = items.length > 1;
	const step = (by: number) => {
		if (index !== null && many) {
			onIndex((index + by + items.length) % items.length);
		}
	};

	const onKeyDown = (event: KeyboardEvent) => {
		if (editing !== null) {
			handleAnnotateKeyDown(event, editing, () => void finishMarkUp());
			return;
		}
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
			void startMarkUp(shown).catch(() => {});
		}
	};

	const isOpen = shown !== undefined || editing !== null;
	const closeBackdrop = (target: EventTarget, currentTarget: EventTarget) => {
		if (target !== currentTarget) {
			return;
		}
		if (editing !== null) {
			void finishMarkUp();
		} else {
			onClose();
		}
	};

	return (
		<DialogPrimitive.Root
			open={isOpen}
			onOpenChange={(open) => {
				if (open) {
					return;
				}
				if (editing !== null) {
					if (editing.selected !== null) {
						editing.select(null);
					} else {
						void finishMarkUp();
					}
				} else {
					onClose();
				}
			}}
		>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Backdrop
					// The task or todo it opens from is often a dialog itself, whose own
					// backdrop would otherwise be the only one shown.
					forceRender
					className={LIGHTBOX_BACKDROP_CLASS}
				/>
				<DialogPrimitive.Popup
					data-slot={editing !== null ? "annotate" : "lightbox"}
					ref={popup}
					// The lightbox itself takes focus, so no control is ringed until
					// the keyboard moves to it.
					initialFocus={popup}
					finalFocus={editing !== null ? markUpInPlace?.finalFocus : undefined}
					onKeyDown={onKeyDown}
					// A click on the dimmed space around the media closes it, as a
					// click on the backdrop would: the popup covers the backdrop.
					onClick={(event) => closeBackdrop(event.target, event.currentTarget)}
					style={editing !== null ? annotateStyle : undefined}
					className={LIGHTBOX_POPUP_CLASS}
				>
					{editing !== null ? (
						<AnnotateContent
							annotation={editing}
							onDone={() => void finishMarkUp()}
						/>
					) : (
						shown && (
							<>
								<DialogPrimitive.Title className="sr-only">
									{shown.alt ||
										(shown.html ? "page" : shown.video ? "recording" : "image")}
								</DialogPrimitive.Title>
								<LightboxHeader
									title={
										shown.alt ||
										(shown.html
											? "Preview"
											: shown.video
												? "Recording"
												: "Image")
									}
									meta={
										<>
											{many && (
												<span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-white/70 text-xs tabular-nums">
													{(index ?? 0) + 1} of {items.length}
												</span>
											)}
											{!narrow && shown.html && (
												<span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-white/70 text-xs">
													<ShieldCheckIcon aria-hidden className="size-3.5" />
													Sandboxed
												</span>
											)}
										</>
									}
									center={
										!narrow &&
										!shown.video &&
										!shown.html &&
										fitControl !== null ? (
											<FitSegments control={fitControl} />
										) : undefined
									}
									actions={
										!narrow ? (
											<>
												{markable && (
													<Button
														variant="ghost"
														size="sm"
														aria-label="Mark up"
														title="Mark up"
														onClick={() =>
															void startMarkUp(shown).catch(() => {})
														}
														className={cn(LIGHTBOX_ACTION, "bg-white/10")}
													>
														<PencilIcon />
														<span>Mark up</span>
													</Button>
												)}
												<a
													href={shown.url}
													target="_blank"
													rel="noreferrer"
													aria-label="open in a new tab"
													title="Pop out"
													className={cn(
														buttonVariants({
															variant: "ghost",
															size: "icon-sm",
														}),
														LIGHTBOX_ACTION,
													)}
												>
													<ExternalLinkIcon />
												</a>
											</>
										) : undefined
									}
								/>
								{shown.html ? (
									// biome-ignore lint/a11y/useKeyWithClickEvents: Escape is handled on the dialog popup and via iframe bridge
									// biome-ignore lint/a11y/noStaticElementInteractions: clicking dark margin around the framed page closes
									<div
										onClick={(event) =>
											closeBackdrop(event.target, event.currentTarget)
										}
										className="flex min-h-0 w-full flex-1 flex-col sm:p-3"
									>
										<iframe
											ref={iframeRef}
											key={shown.url}
											src={shown.url}
											title={shown.alt}
											sandbox="allow-scripts"
											referrerPolicy="no-referrer"
											className="min-h-0 w-full flex-1 bg-white sm:rounded-xl sm:border sm:border-white/10 sm:shadow-2xl"
										/>
									</div>
								) : shown.video ? (
									// biome-ignore lint/a11y/useKeyWithClickEvents: keyboard handled on dialog popup
									// biome-ignore lint/a11y/noStaticElementInteractions: clicking dark stage around video closes
									<div
										onClick={(event) =>
											closeBackdrop(event.target, event.currentTarget)
										}
										className="flex min-h-0 w-full flex-1 items-center justify-center p-4 sm:p-8"
									>
										{/* biome-ignore lint/a11y/useMediaCaption: an agent's screen recording has no captions to give */}
										<video
											key={shown.url}
											src={shown.url}
											title={shown.alt}
											controls
											autoPlay
											className="max-h-full max-w-full rounded-md object-contain"
										/>
									</div>
								) : (
									<ZoomableImage
										key={shown.url}
										src={shown.url}
										alt={shown.alt}
										vector={SVG.test(nameOf(shown))}
										onFitControl={setFitControl}
										className="min-h-0 flex-1"
									/>
								)}
								{many && (
									<div
										className={cn(
											"z-10 flex w-full shrink-0 items-center justify-center",
											narrow
												? "gap-1 px-1.5 py-1.5"
												: "gap-2 px-3 pt-1.5 pb-[max(0.75rem,env(safe-area-inset-bottom))]",
										)}
									>
										<Button
											variant="ghost"
											size={narrow ? "icon" : "icon-sm"}
											aria-label="previous"
											onClick={() => step(-1)}
											className={cn(
												"shrink-0",
												narrow
													? LIGHTBOX_MOBILE_TOOL
													: cn(
															LIGHTBOX_ACTION,
															"border border-white/15 bg-white/8",
														),
											)}
										>
											<ChevronLeftIcon
												className={narrow ? "size-8.5" : undefined}
											/>
										</Button>
										<Thumbnails
											items={items}
											index={index ?? 0}
											onIndex={onIndex}
										/>
										<Button
											variant="ghost"
											size={narrow ? "icon" : "icon-sm"}
											aria-label="next"
											onClick={() => step(1)}
											className={cn(
												"shrink-0",
												narrow
													? LIGHTBOX_MOBILE_TOOL
													: cn(
															LIGHTBOX_ACTION,
															"border border-white/15 bg-white/8",
														),
											)}
										>
											<ChevronRightIcon
												className={narrow ? "size-8.5" : undefined}
											/>
										</Button>
									</div>
								)}
								{narrow && (
									<MobileActionDock
										shown={shown}
										fitControl={!shown.video && !shown.html ? fitControl : null}
										markable={markable}
										onMarkUp={() => void startMarkUp(shown).catch(() => {})}
									/>
								)}
							</>
						)
					)}
				</DialogPrimitive.Popup>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}

/** Desktop centered segmented control for Fit width / Fit all in the top bar. */
function FitSegments({ control }: { control: FitControl }): JSX.Element {
	return (
		<fieldset
			aria-label="Image fit"
			className="flex rounded-lg bg-white/10 p-0.5"
		>
			{(["width", "all"] as const).map((to) => (
				<button
					key={to}
					type="button"
					aria-pressed={control.fit === to}
					onClick={() => control.setFit(to)}
					className={cn(
						"h-7 rounded-md px-2.5 font-medium text-xs transition-colors",
						control.fit === to
							? "bg-white text-black"
							: "text-white/80 hover:text-white",
					)}
				>
					{to === "width" ? "Fit width" : "Fit all"}
				</button>
			))}
		</fieldset>
	);
}

/**
 * Phone thumb-zone action dock rendered at the foot of the lightbox, keeping
 * Fit, Mark up, and Pop out at 44px touch targets away from the top-right Close.
 */
function MobileActionDock({
	shown,
	fitControl,
	markable,
	onMarkUp,
}: {
	shown: Shown;
	fitControl: FitControl | null;
	markable: boolean;
	onMarkUp: () => void;
}): JSX.Element {
	const nextFit = fitControl?.fit === "width" ? "all" : "width";
	const fitLabel = nextFit === "all" ? "Fit all" : "Fit width";
	const hasLeftActions = fitControl !== null || markable;
	const pillClass =
		"inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/9 px-3.5 font-medium text-[13.5px] text-white transition-colors hover:bg-white/15 active:bg-white/20";
	return (
		<div
			data-slot="lightbox-dock"
			className="z-10 flex w-full shrink-0 items-center gap-2 border-white/10 border-t bg-[#111114] px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
		>
			{shown.html && (
				<span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-white/75 text-xs">
					<ShieldCheckIcon aria-hidden className="size-3.5" />
					Sandboxed
				</span>
			)}
			{fitControl !== null && (
				<button
					type="button"
					onClick={() => fitControl.setFit(nextFit)}
					className={pillClass}
				>
					{nextFit === "all" ? (
						<Minimize2Icon aria-hidden className="size-4" />
					) : (
						<Maximize2Icon aria-hidden className="size-4" />
					)}
					<span>{fitLabel}</span>
				</button>
			)}
			{markable && (
				<button
					type="button"
					aria-label="Mark up"
					title="Mark up"
					onClick={onMarkUp}
					className={pillClass}
				>
					<PencilIcon aria-hidden className="size-4" />
					<span>Mark up</span>
				</button>
			)}
			<a
				href={shown.url}
				target="_blank"
				rel="noreferrer"
				aria-label="open in a new tab"
				title="Pop out"
				className={cn(
					"ml-auto inline-flex shrink-0 items-center justify-center border border-white/16 bg-white/8 font-medium text-[13.5px] text-white/90 transition-colors hover:bg-white/15 hover:text-white active:bg-white/20",
					hasLeftActions
						? "size-11 rounded-[11px]"
						: "h-11 gap-1.5 rounded-xl px-3.5",
				)}
			>
				<ExternalLinkIcon
					aria-hidden
					className={hasLeftActions ? "size-[18px]" : "size-4"}
				/>
				{!hasLeftActions && <span>Open in new tab</span>}
			</a>
		</div>
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
					aria-label={`show ${item.alt || (item.html ? "page" : item.video ? "recording" : "image")}`}
					aria-current={at === index}
					ref={(button) => {
						if (at === index) {
							button?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
						}
					}}
					onClick={() => onIndex(at)}
					className={cn(
						"size-12 shrink-0 overflow-hidden rounded-lg border-2 bg-white transition-opacity md:size-14",
						at === index
							? "border-primary opacity-100"
							: "border-transparent opacity-50 hover:opacity-80",
					)}
				>
					{item.html ? (
						<span className="flex size-full flex-col items-center justify-center gap-0.5 bg-neutral-100 text-neutral-700">
							<AppWindowIcon aria-hidden className="size-4" />
							<span className="max-w-full truncate px-1 font-semibold text-[9px] tracking-wide">
								HTML
							</span>
						</span>
					) : item.video ? (
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
