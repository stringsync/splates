import { ArchiveIcon } from "lucide-react";
import {
	type JSX,
	type PointerEvent,
	type ReactNode,
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
	const [offset, setOffset] = useState(0);
	// Set as it leaves: its height, then closed to 0.
	const [height, setHeight] = useState<number | null>(null);
	const [leaving, setLeaving] = useState(false);
	const box = useRef<HTMLDivElement>(null);
	const start = useRef<{ x: number; y: number } | null>(null);
	const swiping = useRef(false);
	// Set when a swipe ends, so the tap the browser sends after it opens nothing.
	const swiped = useRef(false);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	useEffect(() => () => clearTimeout(timer.current), []);
	if (archive === null) {
		return <>{children}</>;
	}
	const back = () => {
		setLeaving(false);
		setHeight(null);
		setOffset(0);
	};
	const leave = () => {
		const ms = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
			? 0
			: LEAVE_MS;
		setLeaving(true);
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
				aria-hidden
				className="absolute inset-0 flex items-center justify-end gap-2 bg-primary px-6 font-medium text-primary-foreground text-sm [&_svg]:size-5"
				style={{ opacity: offset === 0 && !leaving ? 0 : 1 }}
			>
				<ArchiveIcon />
				Archive
			</div>
			<div
				// Up and down stay the browser's to scroll; sideways is the swipe's.
				className="relative touch-pan-y bg-background motion-reduce:transition-none"
				style={{
					transform: leaving ? "translateX(-100%)" : `translateX(${offset}px)`,
					transition: swiping.current
						? "none"
						: `transform ${LEAVE_MS}ms ${leaving ? "ease-in" : "ease-out"}`,
				}}
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
					setOffset(Math.min(0, dx));
				}}
				onPointerUp={(event: PointerEvent) => {
					const far =
						swiping.current &&
						start.current !== null &&
						start.current.x - event.clientX >= SWIPE_PX;
					end();
					if (!far) {
						setOffset(0);
					} else if (archive.asks()) {
						setOffset(0);
						archive.file();
					} else {
						leave();
					}
				}}
				onPointerCancel={() => {
					end();
					setOffset(0);
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
