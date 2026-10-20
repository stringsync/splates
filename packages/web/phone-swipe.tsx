import { ArchiveIcon } from "lucide-react";
import {
	type JSX,
	type PointerEvent,
	type ReactNode,
	type RefObject,
	useEffect,
	useRef,
	useState,
} from "react";

/** How far left a row is swiped, in pixels, before letting go archives it. */
export const SWIPE_PX = 120;

/** How far a finger moves, in pixels, before it is a swipe or a scroll. */
const DRIFT_PX = 10;

/** How long a let-go row takes to slide off, then to close up, in ms. */
const LEAVE_MS = 200;

/** What a swiped row archives. */
export type Archive = {
	/** Whether archiving would ask first. */
	asks: () => boolean;
	file: (then?: () => void, failed?: () => void) => void;
};

/**
 * Slides a row left under a finger, over an Archive backing, as iOS Mail's
 * rows slide. Let go short of `SWIPE_PX`, it slides back. Past it, a row
 * whose archiving asks first slides back as the question opens; any other
 * slides off, closes up so the rows below rise into its place, and only then
 * is archived, so it is gone before the list moves. A finger that moves up or
 * down first scrolls instead, and one moving right is left to the browser,
 * whose swipe from the edge goes back.
 */
export function Swipeable({
	archive,
	children,
}: {
	/** Null when the row cannot be archived, so it does not slide. */
	archive: Archive | null;
	children: ReactNode;
}): JSX.Element {
	// Set as it leaves: its height, then closed to 0.
	const [height, setHeight] = useState<number | null>(null);
	const [leaving, setLeaving] = useState(false);
	const box = useRef<HTMLDivElement>(null);
	// Moved on the DOM, not through state, so a finger's every move costs no
	// render of the row.
	const row = useRef<HTMLDivElement>(null);
	const backing = useRef<HTMLDivElement>(null);
	const start = useRef<{ x: number; y: number } | null>(null);
	const swiping = useRef(false);
	// Set when a swipe ends, so the tap the browser sends after it opens nothing.
	const swiped = useRef(false);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	useEffect(() => () => clearTimeout(timer.current), []);
	if (archive === null) {
		return <>{children}</>;
	}
	// Puts the row at `to`, following the finger at once or easing there.
	const slide = (to: string, ease: "none" | "ease-out" | "ease-in") => {
		if (row.current !== null) {
			row.current.style.transition =
				ease === "none" ? "none" : `transform ${LEAVE_MS}ms ${ease}`;
			row.current.style.transform = to;
		}
		if (backing.current !== null) {
			backing.current.style.opacity = to === "translateX(0px)" ? "0" : "1";
		}
	};
	const settle = () => {
		slide("translateX(0px)", "ease-out");
	};
	const back = () => {
		setLeaving(false);
		setHeight(null);
		settle();
	};
	const leave = () => {
		const ms = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
			? 0
			: LEAVE_MS;
		setLeaving(true);
		slide("translateX(-100%)", "ease-in");
		setHeight(box.current?.offsetHeight ?? 0);
		timer.current = setTimeout(() => {
			setHeight(0);
			timer.current = setTimeout(() => {
				// Something it would lose may have started meanwhile.
				if (archive.asks()) {
					back();
				}
				archive.file(undefined, back);
			}, ms);
		}, ms);
	};
	const end = () => {
		start.current = null;
		if (swiping.current) {
			swiping.current = false;
			swiped.current = true;
		}
	};
	return (
		<div
			ref={box}
			className="relative overflow-hidden transition-[height] duration-200 ease-out motion-reduce:transition-none"
			style={height === null ? undefined : { height }}
		>
			<div
				ref={backing}
				aria-hidden
				className="absolute inset-0 flex items-center justify-end gap-2 bg-primary px-6 font-medium text-primary-foreground text-sm opacity-0 [&_svg]:size-5"
			>
				<ArchiveIcon />
				Archive
			</div>
			<div
				ref={row}
				// Up and down stay the browser's to scroll; sideways is the swipe's.
				className="relative touch-pan-y bg-background motion-reduce:transition-none"
				onPointerDown={(event: PointerEvent) => {
					if (leaving) {
						return;
					}
					swiped.current = false;
					start.current = { x: event.clientX, y: event.clientY };
				}}
				onPointerMove={(event: PointerEvent) => {
					if (start.current === null) {
						return;
					}
					const dx = event.clientX - start.current.x;
					const dy = event.clientY - start.current.y;
					if (!swiping.current) {
						if (Math.hypot(dx, dy) <= DRIFT_PX) {
							return;
						}
						if (dx >= 0 || Math.abs(dy) >= Math.abs(dx)) {
							start.current = null;
							return;
						}
						swiping.current = true;
						// Kept when the finger leaves the row.
						event.currentTarget.setPointerCapture?.(event.pointerId);
					}
					slide(`translateX(${Math.min(0, dx)}px)`, "none");
				}}
				onPointerUp={(event: PointerEvent) => {
					const far =
						swiping.current &&
						start.current !== null &&
						start.current.x - event.clientX >= SWIPE_PX;
					end();
					if (!far) {
						settle();
					} else if (archive.asks()) {
						settle();
						archive.file();
					} else {
						leave();
					}
				}}
				onPointerCancel={() => {
					end();
					settle();
				}}
				onClickCapture={(event) => {
					if (swiped.current || leaving) {
						swiped.current = false;
						event.preventDefault();
						event.stopPropagation();
					}
				}}
			>
				{children}
			</div>
		</div>
	);
}

/** How wide the strip along the right edge is, in pixels, that starts a swipe. */
const EDGE_PX = 24;

/** How fast a flick is, in pixels per ms, that archives from a shorter pull. */
const FLICK_PX_MS = 0.5;

/** The shortest pull a flick archives from, in pixels. */
const FLICK_MIN_PX = 40;

/**
 * A strip along the right edge of a screen whose finger, pulled left, slides
 * `target` away over an Archive backing, as `Swipeable`'s rows slide. Only the
 * edge starts it, so what the screen scrolls sideways, as a code block does, is
 * left alone. Let go short of `SWIPE_PX`, the screen slides back; past it, an
 * archiving that asks first slides back as the question opens, and any other
 * slides off before it is filed.
 */
export function EdgeSwipe({
	archive,
	target,
}: {
	archive: Archive;
	target: RefObject<HTMLElement | null>;
}): JSX.Element {
	const backing = useRef<HTMLDivElement>(null);
	const label = useRef<HTMLDivElement>(null);
	// Whether the pull is past SWIPE_PX, so letting go would archive.
	const past = useRef(false);
	// When the finger went down, to tell a flick.
	const began = useRef(0);
	const start = useRef<{ x: number; y: number } | null>(null);
	const swiping = useRef(false);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	useEffect(() => () => clearTimeout(timer.current), []);
	// Puts the screen `dx` pixels left (0 or less), fading the backing in with
	// the pull and deepening it once letting go would archive.
	const slide = (dx: number, ease: "none" | "ease-out" | "ease-in") => {
		const pulled = Math.abs(dx);
		const progress = Math.min(1, pulled / SWIPE_PX);
		const isPast = pulled >= SWIPE_PX;
		if (isPast && !past.current && ease === "none") {
			navigator.vibrate?.(10);
		}
		past.current = isPast;
		// Past the threshold the screen follows the finger at half speed.
		const shown = isPast ? -(SWIPE_PX + (pulled - SWIPE_PX) / 2) : dx;
		const motion = ease === "none" ? "none" : `transform ${LEAVE_MS}ms ${ease}`;
		if (target.current !== null) {
			target.current.style.transition = motion;
			target.current.style.transform = `translateX(${ease === "ease-in" ? dx : shown}px)`;
			target.current.style.boxShadow =
				dx < 0 ? "-8px 0 24px rgb(0 0 0 / 0.18)" : "";
		}
		if (backing.current !== null) {
			backing.current.style.opacity = String(progress);
			backing.current.style.filter = isPast ? "brightness(0.88)" : "";
		}
		if (label.current !== null) {
			label.current.style.transition = "transform 120ms ease-out";
			label.current.style.transform = `scale(${isPast ? 1.15 : 0.7 + 0.3 * progress})`;
		}
	};
	const settle = () => slide(0, "ease-out");
	const end = () => {
		start.current = null;
		swiping.current = false;
	};
	return (
		<>
			<div
				ref={backing}
				aria-hidden
				className="pointer-events-none fixed inset-x-0 -z-10 flex items-center justify-end gap-2 bg-primary px-6 font-medium text-primary-foreground text-sm opacity-0 [&_svg]:size-5"
			>
				<div ref={label} className="flex items-center gap-2 scale-[0.7]">
					<ArchiveIcon />
					Archive
				</div>
			</div>
			<div
				data-testid="edge-swipe"
				// Below the bar and above the composer, whose buttons sit near the edge.
				className="fixed right-0 bottom-24 top-[calc(env(safe-area-inset-top)+var(--top-bar-height))] z-20 touch-none"
				style={{ width: EDGE_PX }}
				onPointerDown={(event: PointerEvent) => {
					start.current = { x: event.clientX, y: event.clientY };
					began.current = event.timeStamp;
					// Taken at once, so the browser cannot claim the touch for its own
					// and cancel the pull, which snapped the screen back.
					event.currentTarget.setPointerCapture?.(event.pointerId);
				}}
				onPointerMove={(event: PointerEvent) => {
					if (start.current === null) {
						return;
					}
					const dx = event.clientX - start.current.x;
					const dy = event.clientY - start.current.y;
					if (!swiping.current) {
						if (Math.hypot(dx, dy) <= DRIFT_PX) {
							return;
						}
						// The strip scrolls nothing, so a pull that drifts down is still ours.
						if (dx >= 0 && Math.abs(dy) < Math.abs(dx)) {
							start.current = null;
							return;
						}
						swiping.current = true;
						event.currentTarget.setPointerCapture?.(event.pointerId);
						// Behind the screen's own box only, not the safe-area padding
						// around it, where the backing would show as a band.
						const box = target.current?.getBoundingClientRect();
						if (box !== undefined && backing.current !== null) {
							backing.current.style.top = `${box.top}px`;
							backing.current.style.height = `${box.height}px`;
						}
					}
					slide(Math.min(0, dx), "none");
				}}
				onPointerUp={(event: PointerEvent) => {
					const pulled =
						start.current === null ? 0 : start.current.x - event.clientX;
					const flicked =
						pulled >= FLICK_MIN_PX &&
						pulled / Math.max(1, event.timeStamp - began.current) >=
							FLICK_PX_MS;
					const far = swiping.current && (pulled >= SWIPE_PX || flicked);
					end();
					if (!far || archive.asks()) {
						settle();
						if (far) {
							archive.file();
						}
						return;
					}
					const ms = window.matchMedia?.("(prefers-reduced-motion: reduce)")
						.matches
						? 0
						: LEAVE_MS;
					slide(-window.innerWidth, "ease-in");
					timer.current = setTimeout(() => {
						archive.file(undefined, settle);
					}, ms);
				}}
				onPointerCancel={() => {
					end();
					settle();
				}}
			/>
		</>
	);
}
