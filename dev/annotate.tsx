import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { useReactive } from "@webappwiz/react";
import {
	MoveUpRightIcon,
	SquareIcon,
	Trash2Icon,
	Undo2Icon,
} from "lucide-react";
import {
	type JSX,
	type KeyboardEvent,
	type PointerEvent,
	type ReactNode,
	type RefObject,
	useEffect,
	useRef,
	useState,
} from "react";
import { Position } from "webappwiz/geometry";
import { Button } from "#dev/components/ui/button.tsx";
import { cn } from "#dev/lib/utils.ts";
import { Annotation, type Tool } from "./annotation";

/** A control on the dark around the image, in either theme. */
const LIGHT = "text-white hover:bg-white/15 hover:text-white";

/** How far off a mark, in screen pixels, a press still picks it. */
const SLOP = 10;

const TOOLS: { tool: Tool; label: string; key: string; icon: JSX.Element }[] = [
	{ tool: "box", label: "Box", key: "r", icon: <SquareIcon /> },
	{ tool: "arrow", label: "Arrow", key: "a", icon: <MoveUpRightIcon /> },
];

/**
 * An annotator to render beside an image, and `open`, which marks up `file`
 * and settles on what to send in its place once the person is done: the
 * image with the marks drawn in, or `file` itself when there are none. The
 * keyboard goes back to `finalFocus` once it closes, when there is one, and
 * otherwise to where it was before.
 */
export function useAnnotate(finalFocus?: RefObject<HTMLElement | null>): {
	open: (file: File) => Promise<File>;
	annotate: JSX.Element;
} {
	const [annotation, setAnnotation] = useState<Annotation | null>(null);
	const finish = useRef<(file: File) => void>(() => {});
	// Each one opened lets go of its image once it closes, or the page does.
	useEffect(() => () => annotation?.dispose(), [annotation]);
	const open = async (file: File) => {
		const opened = await Annotation.open(file);
		setAnnotation(opened);
		return new Promise<File>((resolve) => {
			finish.current = resolve;
		});
	};
	const done = async () => {
		if (annotation === null) {
			return;
		}
		// Left as it was when the browser cannot draw it.
		const file = await annotation.flatten().catch(() => annotation.original);
		setAnnotation(null);
		finish.current(file);
	};
	return {
		open,
		annotate: (
			<Annotate
				annotation={annotation}
				onDone={() => void done()}
				finalFocus={finalFocus}
			/>
		),
	};
}

/**
 * The image at the size of the window, to mark up: a drag draws a box or an
 * arrow, picked with R and A, a click drops a pin, and each mark takes a
 * note. Done, the close button or Escape keeps what is drawn; Escape with a
 * note open closes only the note.
 */
export function Annotate({
	annotation,
	onDone,
	finalFocus,
}: {
	/** What is being marked up, or `null` when the dialog is closed. */
	annotation: Annotation | null;
	onDone: () => void;
	/** Where the keyboard goes once it closes, rather than where it was. */
	finalFocus?: RefObject<HTMLElement | null> | undefined;
}): JSX.Element {
	// The board stays while the dialog closes: base-ui holds the backdrop until
	// the popup's own closing animation ends, and a popup gone never ends it.
	const last = useRef(annotation);
	if (annotation !== null) {
		last.current = annotation;
	}
	return (
		<DialogPrimitive.Root
			open={annotation !== null}
			onOpenChange={(open) => {
				if (open || annotation === null) {
					return;
				}
				if (annotation.selected !== null) {
					annotation.select(null);
				} else {
					onDone();
				}
			}}
		>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Backdrop
					forceRender
					className="fixed inset-0 z-50 bg-black/85 duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
				/>
				{last.current !== null && (
					<Board
						annotation={last.current}
						onDone={onDone}
						finalFocus={finalFocus}
					/>
				)}
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}

function Board({
	annotation,
	onDone,
	finalFocus,
}: {
	annotation: Annotation;
	onDone: () => void;
	finalFocus: RefObject<HTMLElement | null> | undefined;
}): JSX.Element {
	const popup = useRef<HTMLDivElement>(null);
	const canvas = useRef<HTMLCanvasElement>(null);
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
		if (context) {
			annotation.draw(context);
		}
	}, [annotation, marks, selected, draft]);

	/** Where `event` is on the image, in its own pixels. */
	const at = (event: PointerEvent): Position => {
		const box = canvas.current?.getBoundingClientRect();
		if (!box || box.width === 0 || box.height === 0) {
			return Position.origin();
		}
		return new Position(
			((event.clientX - box.left) * annotation.width) / box.width,
			((event.clientY - box.top) * annotation.height) / box.height,
		);
	};
	/** How far off a mark a press may land and still pick it: 10px on screen. */
	const slop = (): number => {
		const width = canvas.current?.getBoundingClientRect().width ?? 0;
		return width === 0 ? 0 : (SLOP * annotation.width) / width;
	};
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
			<div className="flex min-h-0 w-full flex-1 items-center justify-center">
				<div className="relative">
					<canvas
						ref={canvas}
						width={annotation.width}
						height={annotation.height}
						aria-label={`${annotation.original.name}, with ${marks.length} ${marks.length === 1 ? "mark" : "marks"}`}
						className="block max-h-[calc(100dvh-7rem)] max-w-[calc(100vw-4rem)] cursor-crosshair touch-none rounded-md"
						onPointerDown={(event) => {
							if (event.button !== 0) {
								return;
							}
							event.currentTarget.setPointerCapture(event.pointerId);
							annotation.press(at(event), slop());
						}}
						onPointerMove={(event) => {
							annotation.move(at(event));
							// Over a mark, a press picks it rather than drawing.
							event.currentTarget.style.cursor =
								draft === null && annotation.markAt(at(event), slop()) !== null
									? "pointer"
									: "";
						}}
						onPointerUp={() => annotation.release()}
						onPointerCancel={() => annotation.release()}
					/>
					{marks.map((mark, each) =>
						each === selected ? (
							<Note
								key={`${mark.kind} ${mark.from.x} ${mark.from.y}`}
								annotation={annotation}
								at={each}
							/>
						) : mark.note.trim() !== "" ? (
							<Label
								key={`${mark.kind} ${mark.from.x} ${mark.from.y}`}
								annotation={annotation}
								at={each}
							/>
						) : null,
					)}
				</div>
			</div>
		</DialogPrimitive.Popup>
	);
}

/** Mark `at`'s note being written, beside its number. */
function Note({
	annotation,
	at,
}: {
	annotation: Annotation;
	at: number;
}): JSX.Element {
	const note = useReactive(annotation, (each) => each.marks[at]?.note ?? "", [
		"changed",
	]);
	return (
		<Beside annotation={annotation} at={at} className="w-72 ring-2">
			<input
				// biome-ignore lint/a11y/noAutofocus: a mark just drawn is there to be written about
				autoFocus
				aria-label={`note on mark ${at + 1}`}
				placeholder="What about it?"
				value={note}
				onChange={(event) => annotation.write(at, event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						// Back to the board, where Undo and Delete work again.
						event.currentTarget
							.closest<HTMLElement>("[data-slot=annotate]")
							?.focus();
						annotation.select(null);
					}
				}}
				className="min-w-0 flex-1 bg-transparent px-1 text-black text-sm outline-none placeholder:text-black/40"
			/>
			<Button
				variant="ghost"
				size="icon-xs"
				aria-label={`remove mark ${at + 1}`}
				onClick={() => annotation.remove(at)}
				className="text-black/60 hover:bg-black/10 hover:text-black"
			>
				<Trash2Icon />
			</Button>
		</Beside>
	);
}

/** Mark `at`'s note as written, beside its number; a click opens it again. */
function Label({
	annotation,
	at,
}: {
	annotation: Annotation;
	at: number;
}): JSX.Element {
	const note = annotation.marks[at]?.note.trim() ?? "";
	return (
		<Beside annotation={annotation} at={at} className="max-w-60 ring-1">
			<button
				type="button"
				aria-label={`edit note on mark ${at + 1}: ${note}`}
				onClick={() => annotation.select(at)}
				className="line-clamp-3 min-w-0 cursor-pointer px-1 text-left text-black text-sm"
			>
				{note}
			</button>
		</Beside>
	);
}

/**
 * A card beside mark `at`'s number, led by that number, on whichever side of
 * it has room.
 */
function Beside({
	annotation,
	at,
	className,
	children,
}: {
	annotation: Annotation;
	at: number;
	className: string;
	children: ReactNode;
}): JSX.Element {
	const anchor = annotation.anchor(at);
	const left = anchor.x / annotation.width;
	const gap = `calc(${((annotation.badge * 1.4) / annotation.width) * 100}% + 0.5rem)`;
	return (
		<div
			className={cn(
				"absolute z-10 flex -translate-y-1/2 items-center gap-1 rounded-lg bg-white p-1 shadow-xl ring-[#ff1f8f]",
				className,
			)}
			style={{
				top: `${(anchor.y / annotation.height) * 100}%`,
				...(left < 0.6
					? { left: `calc(${left * 100}% + ${gap})` }
					: { right: `calc(${(1 - left) * 100}% + ${gap})` }),
			}}
		>
			<span className="flex size-6 shrink-0 items-center justify-center self-start rounded-full bg-[#ff1f8f] font-bold text-white text-xs">
				{at + 1}
			</span>
			{children}
		</div>
	);
}
