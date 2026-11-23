import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Position, Rect } from "core/geometry";
import { useReactive } from "core/react";
import { Undo2Icon, XIcon } from "lucide-react";
import {
	type JSX,
	type KeyboardEvent,
	type PointerEvent,
	type RefObject,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { flushSync } from "react-dom";
import { Button } from "#web/components/ui/button.tsx";
import { Kbd } from "#web/components/ui/kbd.tsx";
import { useTouch } from "#web/hooks/use-touch.ts";
import { useViewport } from "#web/hooks/use-viewport.ts";
import { cn } from "#web/lib/utils.ts";
import { NoteBar, ToolDock } from "./annotate-phone";
import { LIGHT, TOOLS } from "./annotate-tools";
import type { Annotation } from "./annotation";
import { MarkList } from "./mark-notes";
import { NoteSheet } from "./note-sheet";

/** How far off a mark, in screen pixels, a press still picks it. */
const SLOP = 10;

/**
 * How far past the image, in screen pixels, marks and notes may go: room to
 * start an arrow off the image, kept to a share of a small screen, and on a
 * phone to a sliver, where every pixel of the image counts.
 */
const MARGIN = { most: 120, share: 0.12, phone: 16 };

/** Below Tailwind's `sm`: a phone, where the tools dock at the foot. */
const NARROW = "(max-width: 639.98px)";

export function AnnotateBoard({
	annotation,
	onDone,
	finalFocus,
}: {
	annotation: Annotation;
	onDone: () => void;
	finalFocus: RefObject<HTMLElement | null> | undefined;
}): JSX.Element {
	const popup = useRef<HTMLDivElement>(null);
	const stage = useRef<HTMLDivElement>(null);
	const canvas = useRef<HTMLCanvasElement>(null);
	const view = useView(annotation, stage);
	const touch = useTouch();
	const narrow = useNarrow();
	// On a phone the board fits what the keyboard leaves, so the note bar sits
	// on it and the image shrinks to stay in sight.
	const viewport = useViewport();
	const note = useRef<HTMLTextAreaElement>(null);
	/** The marks and the picked one when the press began. */
	const pressed = useRef({ marks: 0, selected: null as number | null });
	const { marks, tool, selected, draft } = useReactive(
		annotation,
		(each) => ({
			marks: each.marks,
			tool: each.tool,
			selected: each.selected,
			draft: each.draft,
		}),
		["changed"],
	);
	// The canvas is drawn, not rendered: each change paints it again.
	// biome-ignore lint/correctness/useExhaustiveDependencies: each is a change to paint
	useEffect(() => {
		const context = canvas.current?.getContext("2d");
		if (!context || view === null) {
			return;
		}
		const { scale, image, area, pixels } = view;
		context.setTransform(1, 0, 0, 1, 0, 0);
		context.clearRect(0, 0, context.canvas.width, context.canvas.height);
		context.setTransform(
			pixels * scale,
			0,
			0,
			pixels * scale,
			pixels * (image.left - area.left),
			pixels * (image.top - area.top),
		);
		annotation.draw(context);
	}, [annotation, view, marks, selected, draft]);

	/** Where `event` is on the image, in its own pixels. */
	const at = (event: PointerEvent): Position => {
		const box = canvas.current?.getBoundingClientRect();
		if (!box || view === null) {
			return Position.origin();
		}
		return new Position(
			(event.clientX - box.left - (view.image.left - view.area.left)) /
				view.scale,
			(event.clientY - box.top - (view.image.top - view.area.top)) / view.scale,
		);
	};
	/** How far off a mark a press may land and still pick it: 10px on screen. */
	const slop = (): number => (view === null ? 0 : SLOP / view.scale);
	const onKeyDown = (event: KeyboardEvent) => {
		// A field's keys are its own: typing a note never picks a tool, undoes or
		// deletes a mark, or finishes (the note field handles its own Enter).
		if (
			event.target instanceof HTMLElement &&
			event.target.closest("input, textarea, select, [contenteditable]") !==
				null
		) {
			return;
		}
		const picked = TOOLS.find((each) => each.key === event.key.toLowerCase());
		if (event.key === "Enter") {
			// Enter on a button or a field is theirs; anywhere else it is Done.
			if (
				!(event.target instanceof HTMLElement) ||
				!event.target.closest("button, a, input, textarea, select")
			) {
				event.preventDefault();
				onDone();
			}
		} else if ((event.metaKey || event.ctrlKey) && event.key === "z") {
			event.preventDefault();
			annotation.undo();
		} else if (
			picked !== undefined &&
			!(event.metaKey || event.ctrlKey || event.altKey)
		) {
			event.preventDefault();
			annotation.use(picked.tool);
		} else if (
			(event.key === "Backspace" || event.key === "Delete") &&
			selected !== null
		) {
			event.preventDefault();
			annotation.remove(selected);
		}
	};

	return (
		<DialogPrimitive.Popup
			data-slot="annotate"
			ref={popup}
			initialFocus={popup}
			finalFocus={finalFocus}
			onKeyDown={onKeyDown}
			// A click on the margin around the board keeps what is drawn, as Done
			// does: the popup covers the backdrop.
			onClick={(event) => {
				if (event.target === event.currentTarget) {
					onDone();
				}
			}}
			style={
				narrow
					? {
							top: viewport.top,
							height: viewport.height,
							paddingBottom: viewport.keyboard
								? 0
								: "max(1rem, env(safe-area-inset-bottom))",
						}
					: undefined
			}
			className="fixed inset-x-0 top-0 z-50 flex h-dvh flex-col items-center gap-3 px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-4 text-white max-sm:bg-neutral-950 sm:gap-4 sm:px-8 sm:pt-4 sm:pb-8 outline-none duration-150 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
		>
			<DialogPrimitive.Title className="sr-only">
				Mark up {annotation.original.name}
			</DialogPrimitive.Title>
			<div className="flex w-full max-w-3xl items-center gap-1 sm:gap-2">
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="close"
					// Keeps what is drawn, as Done does: only Clear throws marks away.
					onClick={onDone}
					className={LIGHT}
				>
					<XIcon />
				</Button>
				{narrow && (
					<span className="flex-1 text-center font-semibold text-[15px]">
						Mark up
					</span>
				)}
				{!narrow && (
					<fieldset
						aria-label="tool"
						className="flex rounded-lg bg-white/10 p-0.5"
					>
						{TOOLS.map((each) => (
							<Button
								key={each.tool}
								variant="ghost"
								size="sm"
								aria-pressed={tool === each.tool}
								aria-keyshortcuts={each.key.toUpperCase()}
								title={`${each.label} (${each.key.toUpperCase()})`}
								onClick={() => annotation.use(each.tool)}
								className={cn(
									LIGHT,
									tool === each.tool && "bg-white! text-black! hover:bg-white!",
								)}
							>
								{each.icon}
								<span className="max-sm:sr-only">{each.label}</span>
								{!touch && (
									<Kbd
										aria-hidden
										className={cn(
											"max-sm:hidden",
											tool === each.tool
												? "bg-black/10 text-black/60"
												: "bg-white/15 text-white/70",
										)}
									>
										{each.key.toUpperCase()}
									</Kbd>
								)}
							</Button>
						))}
					</fieldset>
				)}
				{!narrow && (
					<span className="min-w-0 flex-1 truncate px-2 text-center text-sm text-white/70">
						Drag to draw, click to pin
					</span>
				)}
				<div className="ml-auto flex items-center gap-1">
					{!narrow && (
						<>
							<Button
								variant="ghost"
								size="sm"
								disabled={marks.length === 0}
								onClick={() => annotation.undo()}
								aria-label="Undo"
								className={LIGHT}
							>
								<Undo2Icon />
								<span className="max-sm:hidden">Undo</span>
							</Button>
							<Button
								variant="ghost"
								size="sm"
								disabled={marks.length === 0}
								onClick={() => annotation.clear()}
								className={LIGHT}
							>
								Clear
							</Button>
						</>
					)}
					<Button
						size="sm"
						onClick={onDone}
						className="ml-1 max-sm:rounded-full max-sm:px-4 bg-white text-black hover:bg-white/85 sm:ml-2"
					>
						Done
					</Button>
				</div>
			</div>
			<div className="relative flex min-h-0 w-full flex-1 flex-col gap-3 sm:flex-row sm:gap-4">
				<div
					ref={stage}
					// A click past the frame falls through to the popup, which closes.
					className="pointer-events-none relative min-h-0 min-w-0 flex-1"
				>
					<canvas
						ref={canvas}
						width={Math.round((view?.area.w ?? 0) * (view?.pixels ?? 1))}
						height={Math.round((view?.area.h ?? 0) * (view?.pixels ?? 1))}
						aria-label={`${annotation.original.name}, with ${marks.length} ${marks.length === 1 ? "mark" : "marks"}`}
						// The frame shows how far past the image marks may go.
						className="pointer-events-auto absolute cursor-crosshair touch-none rounded-lg bg-white/5 outline-1 outline-white/25 outline-dashed"
						style={
							view === null
								? { inset: 0 }
								: {
										left: view.area.left,
										top: view.area.top,
										width: view.area.w,
										height: view.area.h,
									}
						}
						onPointerDown={(event) => {
							if (event.button !== 0) {
								return;
							}
							event.currentTarget.setPointerCapture(event.pointerId);
							pressed.current = {
								marks: annotation.marks.length,
								selected: annotation.selected,
							};
							annotation.press(at(event), slop());
						}}
						onPointerMove={(event) => {
							annotation.move(at(event));
							// Over a number or a line, a press picks its mark.
							event.currentTarget.style.cursor =
								draft === null && annotation.markAt(at(event), slop()) !== null
									? "pointer"
									: "";
						}}
						onPointerUp={() => {
							if (!narrow) {
								annotation.release();
								return;
							}
							// A mark drawn or tapped is there to be written about: its note
							// is focused in the press itself, so a phone raises its keyboard.
							flushSync(() => annotation.release());
							const { marks: before, selected: was } = pressed.current;
							const picked = annotation.selected;
							if (
								picked !== null &&
								(annotation.marks.length > before || picked !== was)
							) {
								note.current?.focus({ preventScroll: true });
							}
						}}
						onPointerCancel={() => annotation.release()}
					/>
				</div>
				{!narrow && (
					<NoteSheet label="Marks" count={marks.length} wide="sm">
						<MarkList annotation={annotation} />
					</NoteSheet>
				)}
			</div>
			{narrow && <NoteBar annotation={annotation} field={note} />}
			{narrow && selected === null && (
				<>
					{marks.length === 0 && (
						<p className="shrink-0 text-center text-sm text-white/50">
							Drag to draw, tap to pin
						</p>
					)}
					<ToolDock annotation={annotation} />
				</>
			)}
		</DialogPrimitive.Popup>
	);
}

/** Whether the window is a phone's width, following it as it resizes. */
function useNarrow(): boolean {
	return useSyncExternalStore(
		(changed) => {
			const query = matchMedia(NARROW);
			query.addEventListener("change", changed);
			return () => query.removeEventListener("change", changed);
		},
		() => matchMedia(NARROW).matches,
	);
}

/** How the board shows the image, in CSS pixels on `stage`. */
interface View {
	/** Where the image shows on the stage, shrunk to fit it. */
	image: Rect;
	/** The image and the margin around it that marks may go into. */
	area: Rect;
	/** Screen pixels to one of the image's. */
	scale: number;
	/** Device pixels to a CSS pixel, so the canvas draws sharp. */
	pixels: number;
}

/**
 * The image fit in the middle of `stage` inside a margin, never past its own
 * size, and the image with that margin given to `annotation` to draw on:
 * `null` until it is laid out.
 */
function useView(
	annotation: Annotation,
	stage: RefObject<HTMLDivElement | null>,
): View | null {
	const [view, setView] = useState<View | null>(null);
	useEffect(() => {
		const element = stage.current;
		if (element === null) {
			return;
		}
		const read = () => {
			// Its layout size, not its box: the dialog opens zooming in.
			const width = element.clientWidth;
			const height = element.clientHeight;
			if (width === 0 || height === 0) {
				return;
			}
			const margin = matchMedia(NARROW).matches
				? MARGIN.phone
				: Math.min(
						MARGIN.most,
						Math.round(Math.min(width, height) * MARGIN.share),
					);
			const scale = Math.min(
				1,
				(width - margin * 2) / annotation.width,
				(height - margin * 2) / annotation.height,
			);
			const across = annotation.width * scale;
			const down = annotation.height * scale;
			const image = new Rect(
				(width - across) / 2,
				(height - down) / 2,
				across,
				down,
			);
			const area = new Rect(
				image.left - margin,
				image.top - margin,
				across + margin * 2,
				down + margin * 2,
			);
			annotation.widen(
				new Rect(
					-margin / scale,
					-margin / scale,
					area.w / scale,
					area.h / scale,
				),
			);
			setView({
				image,
				area,
				scale,
				pixels: window.devicePixelRatio || 1,
			});
		};
		const observer = new ResizeObserver(read);
		observer.observe(element);
		read();
		return () => observer.disconnect();
	}, [annotation, stage]);
	return view;
}
