import { useReactive } from "@webappwiz/react";
import { Trash2Icon } from "lucide-react";
import {
	type DOMAttributes,
	type JSX,
	type ReactNode,
	type RefObject,
	useLayoutEffect,
	useRef,
} from "react";
import { Button } from "#dev/components/ui/button.tsx";
import { useTouch } from "#dev/hooks/use-touch.ts";
import { cn } from "#dev/lib/utils.ts";
import type { Annotation } from "./annotation";

/** The pointer handlers that drag a note card. */
export type Grip = Pick<
	DOMAttributes<HTMLElement>,
	"onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel"
>;

/** Mark `at`'s note being written, led by its number, which drags it. */
export function Note({
	annotation,
	at,
	grip,
	bounds,
}: {
	annotation: Annotation;
	at: number;
	grip: Grip;
	/** What the card must show whole within. */
	bounds: RefObject<HTMLElement | null>;
}): JSX.Element {
	const touch = useTouch();
	const note = useReactive(annotation, (each) => each.marks[at]?.note ?? "", [
		"changed",
	]);
	return (
		<Beside
			annotation={annotation}
			at={at}
			bounds={bounds}
			className="w-72 ring-2"
			numberProps={grip}
		>
			<input
				// biome-ignore lint/a11y/noAutofocus: a mark just drawn is there to be written about, though a finger taps to, keeping the keyboard down until then
				autoFocus={!touch}
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
				className="min-w-0 flex-1 bg-transparent px-1 pointer-coarse:h-10 text-black text-sm pointer-coarse:text-base outline-none placeholder:text-black/40"
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

/**
 * Mark `at`'s note as written, led by its number: a drag moves it, a click
 * opens it again.
 */
export function Label({
	annotation,
	at,
	grip,
	bounds,
}: {
	annotation: Annotation;
	at: number;
	grip: Grip;
	/** What the card must show whole within. */
	bounds: RefObject<HTMLElement | null>;
}): JSX.Element {
	const note = annotation.marks[at]?.note.trim() ?? "";
	return (
		<Beside
			annotation={annotation}
			at={at}
			bounds={bounds}
			className="w-max max-w-60 cursor-grab touch-none ring-1"
			{...grip}
		>
			<button
				type="button"
				aria-label={`edit note on mark ${at + 1}: ${note}`}
				// The pointer opens it on letting go of a press that never
				// moved; this is the keyboard's click, which has no press.
				onClick={(event) => {
					if (event.detail === 0) {
						annotation.select(at);
					}
				}}
				className="line-clamp-3 min-w-0 cursor-grab px-1 text-left text-black text-sm"
			>
				{note}
			</button>
		</Beside>
	);
}

/**
 * A card led by mark `at`'s number, beside where its note was dragged, or
 * else beside the number on the image, on the side away from the mark, moved
 * where it would run past `bounds` so its number stays there to drag.
 */
function Beside({
	annotation,
	at,
	bounds,
	className,
	numberProps,
	children,
	...grip
}: Grip & {
	annotation: Annotation;
	at: number;
	bounds: RefObject<HTMLElement | null>;
	className: string;
	/** What the number leading the card does, such as drag it. */
	numberProps?: Grip;
	children: ReactNode;
}): JSX.Element {
	const card = useRef<HTMLDivElement>(null);
	const label = annotation.label(at);
	const left = label.x / annotation.width;
	const share = (annotation.badge * 1.4) / annotation.width;
	const side = annotation.side(at);
	// Laid out where it belongs first, then moved before it paints.
	useLayoutEffect(() => {
		const element = card.current;
		const area = bounds.current?.getBoundingClientRect();
		const image = element?.parentElement?.getBoundingClientRect();
		if (!element || !area || !image) {
			return;
		}
		element.style.transform = "";
		const box = element.getBoundingClientRect();
		// The board opens zooming in: screen pixels to layout ones.
		const zoom = box.width / element.offsetWidth || 1;
		const shift = fit(box, area, side, (share * image.width + 8 * zoom) * 2);
		element.style.transform = `translate(${shift.x / zoom}px, ${shift.y / zoom}px)`;
	});
	return (
		<div
			ref={card}
			className={cn(
				"pointer-events-auto absolute z-10 flex -translate-y-1/2 items-center gap-1 rounded-lg bg-white p-1 shadow-xl ring-[#ff1f8f]",
				className,
			)}
			style={{
				top: `${(label.y / annotation.height) * 100}%`,
				...(side === "right"
					? { left: `calc(${left * 100}% + ${share * 100}% + 0.5rem)` }
					: { right: `calc(${(1 - left) * 100}% + ${share * 100}% + 0.5rem)` }),
			}}
			{...grip}
		>
			<span
				{...numberProps}
				className={cn(
					"flex size-6 shrink-0 items-center justify-center self-start rounded-full bg-[#ff1f8f] font-bold text-white text-xs",
					numberProps !== undefined && "cursor-grab touch-none",
				)}
			>
				{at + 1}
			</span>
			{children}
		</div>
	);
}

/**
 * How far to move a card at `box` so it shows whole within `area`: across its
 * point to the other `side`, `across` further, when it fits better there, then
 * in from each edge it still runs past, its number's edge winning.
 */
function fit(
	box: DOMRect,
	area: DOMRect,
	side: "left" | "right",
	across: number,
): { x: number; y: number } {
	const flipped =
		side === "right" ? box.left - across - box.width : box.right + across;
	const past = (left: number) =>
		Math.max(0, area.left - left) + Math.max(0, left + box.width - area.right);
	const left = past(flipped) < past(box.left) ? flipped : box.left;
	return {
		x: Math.max(area.left, Math.min(left, area.right - box.width)) - box.left,
		y:
			Math.max(area.top, Math.min(box.top, area.bottom - box.height)) - box.top,
	};
}
