import { type JSX, type PointerEvent, useEffect, useRef } from "react";
import { cn } from "#dev/lib/utils.ts";

/** How far an image zooms in. */
export const MAX = 8;

/** How far a double tap zooms in. */
export const TAP_ZOOM = 2.5;

/** Longest a tap lasts, and longest between the two of a double tap, in ms. */
const TAP_MS = 300;

/** Farthest a tap moves, and farthest apart a double tap's two are, in px. */
const TAP_SLOP = 24;

/**
 * How an image is zoomed: its scale, and how far it is moved from where it
 * lies, scaled from its top left corner.
 */
export interface View {
	scale: number;
	x: number;
	y: number;
}

export const UNZOOMED: View = { scale: 1, x: 0, y: 0 };

/**
 * `view` zoomed to `scale`, keeping still the point `at` px from the image's
 * shown top left corner.
 */
export function zoomAt(
	view: View,
	at: { x: number; y: number },
	scale: number,
): View {
	const to = Math.min(MAX, Math.max(1, scale));
	const by = 1 - to / view.scale;
	return { scale: to, x: view.x + at.x * by, y: view.y + at.y * by };
}

/**
 * `view` kept over the image's own box, `width` by `height`, so a pan never
 * drags the image off the space it lies in.
 */
export function within(view: View, width: number, height: number): View {
	const clamp = (at: number, size: number) =>
		Math.min(0, Math.max(size * (1 - view.scale), at));
	return {
		scale: view.scale,
		x: clamp(view.x, width),
		y: clamp(view.y, height),
	};
}

interface Point {
	x: number;
	y: number;
}

interface Down {
	x: number;
	y: number;
	/** Where the pointer was at the last move, to pan or pinch by. */
	last: { x: number; y: number };
	at: number;
}

/**
 * An image that zooms in: a pinch, the wheel or a trackpad pinch zooms at
 * the fingers or the pointer, a double tap or click zooms in there or back
 * out, and a drag pans it while zoomed. The page itself never zooms, so this
 * is how a phone sees a screenshot close up.
 */
export function ZoomableImage({
	src,
	alt,
	className,
}: {
	src: string;
	alt: string;
	className?: string;
}): JSX.Element {
	const image = useRef<HTMLImageElement>(null);
	const view = useRef<View>(UNZOOMED);
	const pointers = useRef(new Map<number, Down>());
	const lastTap = useRef<{ x: number; y: number; at: number } | null>(null);

	// Set on the image itself rather than rendered, so a pinch keeps up with
	// the fingers, and its box is where the next move measures from.
	const show = (next: View) => {
		const shown = image.current;
		if (!shown) {
			return;
		}
		view.current =
			next.scale === 1
				? UNZOOMED
				: within(next, shown.offsetWidth, shown.offsetHeight);
		const { scale, x, y } = view.current;
		shown.style.transform =
			scale === 1 ? "" : `translate(${x}px, ${y}px) scale(${scale})`;
		shown.style.cursor = scale === 1 ? "" : "grab";
	};
	const fromCorner = (at: Point): Point => {
		const box = image.current?.getBoundingClientRect();
		return { x: at.x - (box?.left ?? 0), y: at.y - (box?.top ?? 0) };
	};

	// React's wheel listener is passive, and the wheel must not scroll the page.
	useEffect(() => {
		const shown = image.current;
		const onWheel = (event: WheelEvent) => {
			event.preventDefault();
			// A trackpad pinch comes as the wheel with ctrl held, in small steps,
			// spreading the fingers as a negative delta. A scroll zooms the other
			// way, so fingers moving up a trackpad with macOS's natural scrolling
			// zoom in.
			const rate = event.ctrlKey ? -0.01 : 0.002;
			show(
				zoomAt(
					view.current,
					fromCorner({ x: event.clientX, y: event.clientY }),
					view.current.scale * Math.exp(event.deltaY * rate),
				),
			);
		};
		shown?.addEventListener("wheel", onWheel, { passive: false });
		return () => shown?.removeEventListener("wheel", onWheel);
	});

	const onPointerDown = (event: PointerEvent<HTMLImageElement>) => {
		event.currentTarget.setPointerCapture(event.pointerId);
		const at = { x: event.clientX, y: event.clientY };
		pointers.current.set(event.pointerId, {
			...at,
			last: at,
			at: event.timeStamp,
		});
	};
	const onPointerMove = (event: PointerEvent<HTMLImageElement>) => {
		const moved = pointers.current.get(event.pointerId);
		if (!moved) {
			return;
		}
		const to = { x: event.clientX, y: event.clientY };
		const [first, second] = [...pointers.current.values()];
		if (first && second) {
			const other = moved === first ? second : first;
			const before = {
				mid: middle(moved.last, other.last),
				gap: gap(moved.last, other.last),
			};
			const mid = middle(to, other.last);
			const zoomed = zoomAt(
				view.current,
				fromCorner(before.mid),
				view.current.scale * (gap(to, other.last) / (before.gap || 1)),
			);
			show({
				...zoomed,
				x: zoomed.x + mid.x - before.mid.x,
				y: zoomed.y + mid.y - before.mid.y,
			});
		} else if (view.current.scale > 1) {
			show({
				...view.current,
				x: view.current.x + to.x - moved.last.x,
				y: view.current.y + to.y - moved.last.y,
			});
		}
		moved.last = to;
	};
	const onPointerUp = (event: PointerEvent<HTMLImageElement>) => {
		const down = pointers.current.get(event.pointerId);
		const alone = pointers.current.size === 1;
		pointers.current.delete(event.pointerId);
		if (
			!down ||
			!alone ||
			event.timeStamp - down.at > TAP_MS ||
			gap(down, { x: event.clientX, y: event.clientY }) > TAP_SLOP
		) {
			return;
		}
		const tap = { x: event.clientX, y: event.clientY, at: event.timeStamp };
		const before = lastTap.current;
		if (
			before &&
			tap.at - before.at <= TAP_MS &&
			gap(before, tap) <= TAP_SLOP
		) {
			lastTap.current = null;
			show(
				view.current.scale > 1
					? UNZOOMED
					: zoomAt(view.current, fromCorner(tap), TAP_ZOOM),
			);
		} else {
			lastTap.current = tap;
		}
	};
	const onPointerCancel = (event: PointerEvent<HTMLImageElement>) => {
		pointers.current.delete(event.pointerId);
	};

	return (
		<img
			ref={image}
			src={src}
			alt={alt}
			draggable={false}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={onPointerCancel}
			className={cn(
				"origin-top-left cursor-zoom-in touch-none select-none",
				className,
			)}
		/>
	);
}

function middle(one: Point, other: Point): Point {
	return { x: (one.x + other.x) / 2, y: (one.y + other.y) / 2 };
}

function gap(one: Point, other: Point): number {
	return Math.hypot(one.x - other.x, one.y - other.y);
}
