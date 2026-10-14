import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { useReactive } from "@webappwiz/react";
import { MoveUpRightIcon, SquareIcon, Undo2Icon } from "lucide-react";
import {
	type JSX,
	type KeyboardEvent,
	type PointerEvent,
	type RefObject,
	useEffect,
	useRef,
	useState,
} from "react";
import { Position, Rect } from "webappwiz/geometry";
import { Button } from "#dev/components/ui/button.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { Annotation, Tool } from "./annotation";
import { type Grip, Label, Note } from "./mark-notes";

/** A control on the dark around the image, in either theme. */
const LIGHT = "text-white hover:bg-white/15 hover:text-white";

/** How far off a mark, in screen pixels, a press still picks it. */
const SLOP = 10;

const TOOLS: { tool: Tool; label: string; key: string; icon: JSX.Element }[] = [
	{ tool: "box", label: "Box", key: "r", icon: <SquareIcon /> },
	{ tool: "arrow", label: "Arrow", key: "a", icon: <MoveUpRightIcon /> },
];

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
		const { scale, image, pixels } = view;
		context.setTransform(1, 0, 0, 1, 0, 0);
		context.clearRect(0, 0, context.canvas.width, context.canvas.height);
		context.setTransform(
			pixels * scale,
			0,
			0,
			pixels * scale,
			pixels * image.left,
			pixels * image.top,
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
			(event.clientX - box.left - view.image.left) / view.scale,
			(event.clientY - box.top - view.image.top) / view.scale,
		);
	};
	/** How far off a mark a press may land and still pick it: 10px on screen. */
	const slop = (): number => (view === null ? 0 : SLOP / view.scale);
	/** What drags mark `each`'s note card, leaving its number by the mark. */
	const grip = (each: number): Grip => ({
		onPointerDown: (event) => {
			if (event.button !== 0) {
				return;
			}
			event.currentTarget.setPointerCapture(event.pointerId);
			annotation.hold(each, at(event));
		},
		onPointerMove: (event) => annotation.move(at(event)),
		onPointerUp: () => annotation.release(),
		onPointerCancel: () => annotation.release(),
	});
	const onKeyDown = (event: KeyboardEvent) => {
		if (event.target instanceof HTMLInputElement) {
			return;
		}
		const picked = TOOLS.find((each) => each.key === event.key.toLowerCase());
		if ((event.metaKey || event.ctrlKey) && event.key === "z") {
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
			className="fixed inset-0 z-50 flex flex-col items-center gap-4 px-8 pt-4 pb-8 text-white outline-none duration-150 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
		>
			<DialogPrimitive.Title className="sr-only">
				Mark up {annotation.original.name}
			</DialogPrimitive.Title>
			<div className="flex w-full max-w-3xl flex-wrap items-center justify-center gap-2">
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
							{each.label}
						</Button>
					))}
				</fieldset>
				<span className="px-2 text-sm text-white/70">
					Drag to draw, click to pin
				</span>
				<div className="flex items-center gap-1">
					<Button
						variant="ghost"
						size="sm"
						disabled={marks.length === 0}
						onClick={() => annotation.undo()}
						className={LIGHT}
					>
						<Undo2Icon />
						Undo
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
					<Button
						size="sm"
						onClick={onDone}
						className="ml-2 bg-white text-black hover:bg-white/85"
					>
						Done
					</Button>
				</div>
			</div>
			<div ref={stage} className="relative min-h-0 w-full flex-1">
				<canvas
					ref={canvas}
					width={Math.round((view?.stage.w ?? 0) * (view?.pixels ?? 1))}
					height={Math.round((view?.stage.h ?? 0) * (view?.pixels ?? 1))}
					aria-label={`${annotation.original.name}, with ${marks.length} ${marks.length === 1 ? "mark" : "marks"}`}
					className="absolute inset-0 size-full cursor-crosshair touch-none"
					onPointerDown={(event) => {
						if (event.button !== 0) {
							return;
						}
						event.currentTarget.setPointerCapture(event.pointerId);
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
					onPointerUp={() => annotation.release()}
					onPointerCancel={() => annotation.release()}
				/>
				{view !== null && (
					// Where the image shows, so each note sits by its mark.
					<div
						className="pointer-events-none absolute"
						style={{
							left: view.image.left,
							top: view.image.top,
							width: view.image.w,
							height: view.image.h,
						}}
					>
						{marks.map((mark, each) =>
							each === selected ? (
								<Note
									key={`${mark.kind} ${mark.from.x} ${mark.from.y}`}
									annotation={annotation}
									at={each}
									grip={grip(each)}
								/>
							) : mark.note.trim() !== "" ? (
								<Label
									key={`${mark.kind} ${mark.from.x} ${mark.from.y}`}
									annotation={annotation}
									at={each}
									grip={grip(each)}
								/>
							) : null,
						)}
					</div>
				)}
			</div>
		</DialogPrimitive.Popup>
	);
}

/** How the board shows the image, in CSS pixels on `stage`. */
interface View {
	stage: Rect;
	/** Where the image shows on the stage, shrunk to fit it. */
	image: Rect;
	/** Screen pixels to one of the image's. */
	scale: number;
	/** Device pixels to a CSS pixel, so the canvas draws sharp. */
	pixels: number;
}

/**
 * The image fit in the middle of `stage`, never past its own size, and the
 * whole stage given to `annotation` to draw on: `null` until it is laid out.
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
			const scale = Math.min(
				1,
				width / annotation.width,
				height / annotation.height,
			);
			const across = annotation.width * scale;
			const down = annotation.height * scale;
			const image = new Rect(
				(width - across) / 2,
				(height - down) / 2,
				across,
				down,
			);
			annotation.widen(
				new Rect(
					-image.left / scale,
					-image.top / scale,
					width / scale,
					height / scale,
				),
			);
			setView({
				stage: new Rect(0, 0, width, height),
				image,
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
