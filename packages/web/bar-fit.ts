import { type RefObject, useLayoutEffect, useRef, useState } from "react";

/** Room a title keeps before actions fold away for it, in pixels. */
const TITLE_ROOM = 128;
/** The gap between a bar's items, `gap-1`. */
const GAP = 4;

/**
 * Measures how many of `count` bar actions fit beside the title, detail,
 * status, and restart button, folding overflow actions into a kebab menu.
 */
export function useFit(
	count: number,
	menu: boolean,
): {
	room: RefObject<HTMLDivElement | null>;
	titled: RefObject<HTMLDivElement | null>;
	detailed: RefObject<HTMLDivElement | null>;
	stated: RefObject<HTMLDivElement | null>;
	restart: RefObject<HTMLDivElement | null>;
	measure: RefObject<HTMLDivElement | null>;
	fit: number;
} {
	const room = useRef<HTMLDivElement>(null);
	const titled = useRef<HTMLDivElement>(null);
	const detailed = useRef<HTMLDivElement>(null);
	const stated = useRef<HTMLDivElement>(null);
	const restart = useRef<HTMLDivElement>(null);
	const measure = useRef<HTMLDivElement>(null);
	const [fit, setFit] = useState(count);
	const fitRef = useRef<() => void>(() => {});
	fitRef.current = () => {
		const into = room.current;
		const copies = measure.current;
		if (into === null || copies === null) {
			return;
		}
		// Not laid out, as before the page shows: nothing to fold for.
		if (into.clientWidth === 0) {
			setFit(count);
			return;
		}
		const widths = [...copies.children].map(
			(each) => (each as HTMLElement).offsetWidth,
		);
		const kebab = (widths.pop() ?? 0) + GAP;
		// What the title would take untruncated: its heading's whole width.
		const heading = titled.current?.firstElementChild;
		const title = Math.min(heading?.scrollWidth ?? 0, TITLE_ROOM);
		// The detail and the status keep their whole widths.
		const detail = detailed.current?.offsetWidth ?? 0;
		const status = stated.current?.offsetWidth ?? 0;
		// Update never folds, so keeps its whole width too.
		const restarting = restart.current?.offsetWidth ?? 0;
		const space =
			into.clientWidth -
			title -
			(detail > 0 ? detail + 8 : 0) -
			(status > 0 ? status + 8 : 0) -
			(restarting > 0 ? restarting + GAP : 0);
		const across = (first: number) =>
			widths.slice(0, first).reduce((sum, width) => sum + width + GAP, 0);
		let shown = count;
		while (
			shown > 0 &&
			across(shown) + (menu || shown < count ? kebab : 0) > space
		) {
			shown -= 1;
		}
		setFit(shown);
	};
	useLayoutEffect(() => fitRef.current());
	useLayoutEffect(() => {
		const resized = new ResizeObserver(() => fitRef.current());
		for (const each of [
			room.current,
			titled.current,
			detailed.current,
			stated.current,
			restart.current,
			measure.current,
		]) {
			if (each !== null) {
				resized.observe(each);
			}
		}
		return () => resized.disconnect();
	}, []);
	return {
		room,
		titled,
		detailed,
		stated,
		restart,
		measure,
		fit: Math.min(fit, count),
	};
}
