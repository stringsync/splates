import { type JSX, type PointerEvent, useEffect, useRef } from "react";
import { cn } from "#web/lib/utils.ts";

/** How far an image zooms in. */
export const MAX = 8;

/** How far a double tap zooms in. */
export const TAP_ZOOM = 2.5;

/** Longest a tap lasts, and longest between the two of a double tap, in ms. */
const TAP_MS = 300;

/** Farthest a tap moves, and farthest apart a double tap's two are, in px. */
const TAP_SLOP = 24;

interface Point {
	x: number;
	y: number;
}

/** `scale` kept between no zoom and `MAX`. */
export function clampScale(scale: number): number {
	return Math.min(MAX, Math.max(1, scale));
}

/**
 * Where the scroll position goes so the point `at` px into the viewport stays
 * over the same part of the image when it grows by `ratio`.
 */
export function scrollAfterZoom(
	scroll: number,
	at: number,
	ratio: number,
): number {
	return (scroll + at) * ratio - at;
}

/**
 * An image that zooms in. It is laid out larger inside a box that scrolls, so
 * the browser pans it natively, with momentum, and redraws it sharp at each
 * size rather than stretching a bitmap. A pinch, a trackpad pinch or ctrl and
 * the wheel zooms at the fingers or the pointer, a double tap or click zooms
 * in there or back out, and a mouse drags it while zoomed. The page itself
 * never zooms, so this is how a phone sees a screenshot close up.
 */
export function ZoomableImage({
	src,
	alt,
	className,
}: {
	src: string;
	alt: string;
	/** Sizes the box the image fits in at no zoom. */
	className?: string;
}): JSX.Element {
	const box = useRef<HTMLDivElement>(null);
	const image = useRef<HTMLImageElement>(null);
	const scale = useRef(1);
	const press = useRef<(Point & { at: number; moved: boolean }) | null>(null);
	const lastTap = useRef<(Point & { at: number }) | null>(null);

	const zoomTo = (next: number, at: Point) => {
		const scroller = box.current;
		const shown = image.current;
		if (!scroller || !shown) {
			return;
		}
		const to = clampScale(next);
		const ratio = to / scale.current;
		const rect = scroller.getBoundingClientRect();
		const from = { x: at.x - rect.left, y: at.y - rect.top };
		scale.current = to;
		shown.style.width = shown.style.height = to === 1 ? "" : `${to * 100}%`;
		scroller.dataset.scale = String(to);
		scroller.scrollLeft = scrollAfterZoom(scroller.scrollLeft, from.x, ratio);
		scroller.scrollTop = scrollAfterZoom(scroller.scrollTop, from.y, ratio);
	};
	const centre = (): Point => {
		const rect = box.current?.getBoundingClientRect();
		return {
			x: (rect?.left ?? 0) + (rect?.width ?? 0) / 2,
			y: (rect?.top ?? 0) + (rect?.height ?? 0) / 2,
		};
	};

	// Listeners React would make passive, which must stop the page scrolling
	// or zooming under a pinch.
	useEffect(() => {
		const scroller = box.current;
		if (!scroller) {
			return;
		}
		const onWheel = (event: WheelEvent) => {
			// A trackpad pinch comes as the wheel with ctrl held. Any other wheel
			// scrolls the zoomed image natively.
			if (!event.ctrlKey && !event.metaKey) {
				return;
			}
			event.preventDefault();
			zoomTo(scale.current * Math.exp(-event.deltaY * 0.01), {
				x: event.clientX,
				y: event.clientY,
			});
		};
		let pinch: { gap: number; scale: number; mid: Point } | null = null;
		const touches = (event: TouchEvent): [Point, Point] | null => {
			const [one, two] = [event.touches[0], event.touches[1]];
			return one && two
				? [
						{ x: one.clientX, y: one.clientY },
						{ x: two.clientX, y: two.clientY },
					]
				: null;
		};
		const onTouchStart = (event: TouchEvent) => {
			const both = touches(event);
			pinch = both
				? { gap: gap(...both), scale: scale.current, mid: middle(...both) }
				: null;
		};
		const onTouchMove = (event: TouchEvent) => {
			const both = touches(event);
			if (!both || !pinch) {
				return;
			}
			event.preventDefault();
			const mid = middle(...both);
			zoomTo(pinch.scale * (gap(...both) / (pinch.gap || 1)), mid);
			// Two fingers dragging pan too.
			scroller.scrollLeft -= mid.x - pinch.mid.x;
			scroller.scrollTop -= mid.y - pinch.mid.y;
			pinch.mid = mid;
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "+" || event.key === "=") {
				zoomTo(scale.current * 1.5, centre());
			} else if (event.key === "-") {
				zoomTo(scale.current / 1.5, centre());
			} else if (event.key === "0") {
				zoomTo(1, centre());
			}
		};
		scroller.addEventListener("wheel", onWheel, { passive: false });
		scroller.addEventListener("touchstart", onTouchStart, { passive: true });
		scroller.addEventListener("touchmove", onTouchMove, { passive: false });
		document.addEventListener("keydown", onKeyDown);
		return () => {
			scroller.removeEventListener("wheel", onWheel);
			scroller.removeEventListener("touchstart", onTouchStart);
			scroller.removeEventListener("touchmove", onTouchMove);
			document.removeEventListener("keydown", onKeyDown);
		};
	});

	const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
		const at = { x: event.clientX, y: event.clientY };
		// Touch pans natively; only a mouse is dragged by hand.
		if (event.pointerType === "mouse") {
			event.currentTarget.setPointerCapture(event.pointerId);
		}
		press.current = { ...at, at: event.timeStamp, moved: false };
	};
	const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
		const down = press.current;
		if (!down || event.pointerType !== "mouse" || scale.current === 1) {
			return;
		}
		const scroller = event.currentTarget;
		scroller.scrollLeft -= event.clientX - down.x;
		scroller.scrollTop -= event.clientY - down.y;
		down.x = event.clientX;
		down.y = event.clientY;
		down.moved = true;
	};
	const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
		const down = press.current;
		press.current = null;
		const tap = { x: event.clientX, y: event.clientY, at: event.timeStamp };
		if (!down || down.moved || tap.at - down.at > TAP_MS) {
			return;
		}
		const before = lastTap.current;
		if (
			before &&
			tap.at - before.at <= TAP_MS &&
			gap(before, tap) <= TAP_SLOP
		) {
			lastTap.current = null;
			zoomTo(scale.current > 1 ? 1 : TAP_ZOOM, tap);
		} else {
			lastTap.current = tap;
		}
	};

	return (
		<div
			ref={box}
			data-scale="1"
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			onPointerCancel={() => {
				press.current = null;
			}}
			// Only a pan is left to the browser, so a pinch reaches the touch
			// listeners and the page never zooms.
			className={cn(
				"w-full cursor-grab touch-pan-x touch-pan-y overflow-auto overscroll-contain select-none outline-none [-webkit-tap-highlight-color:transparent] active:cursor-grabbing",
				className,
			)}
		>
			<img
				ref={image}
				src={src}
				alt={alt}
				draggable={false}
				className="block h-full w-full max-w-none object-contain"
			/>
		</div>
	);
}

function middle(one: Point, other: Point): Point {
	return { x: (one.x + other.x) / 2, y: (one.y + other.y) / 2 };
}

function gap(one: Point, other: Point): number {
	return Math.hypot(one.x - other.x, one.y - other.y);
}
