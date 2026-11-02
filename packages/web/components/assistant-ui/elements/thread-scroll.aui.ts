import { useAuiState } from "@assistant-ui/react";
import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";
import { ReadingPlace } from "#web/components/assistant-ui/elements/thread-place.aui.ts";

/**
 * Keeps `viewport`'s scroll padding at the bottom as tall as `footer`, which
 * sticks over the foot of the thread, so what is scrolled into view, as by
 * focusing it, lands above the composer rather than behind it. None while
 * the focus is in the footer: it sits in that padding itself, so the browser,
 * keeping the composer's caret in view, would scroll the thread at each key
 * while the footer stuck along with it.
 */
export function useClearOf(
	viewport: RefObject<HTMLDivElement | null>,
	footer: RefObject<HTMLDivElement | null>,
): void {
	useLayoutEffect(() => {
		const scroller = viewport.current;
		const over = footer.current;
		if (scroller === null || over === null) {
			return;
		}
		let inside = over.contains(document.activeElement);
		const measure = () => {
			scroller.style.scrollPaddingBottom = inside
				? "0px"
				: `${over.offsetHeight}px`;
		};
		const enter = () => {
			inside = true;
			measure();
		};
		const leave = (event: FocusEvent) => {
			inside = over.contains(event.relatedTarget as Node | null);
			measure();
		};
		measure();
		const watching = new ResizeObserver(measure);
		watching.observe(over);
		over.addEventListener("focusin", enter);
		over.addEventListener("focusout", leave);
		return () => {
			watching.disconnect();
			over.removeEventListener("focusin", enter);
			over.removeEventListener("focusout", leave);
		};
	}, [viewport, footer]);
}
/** The timeline of work still going on, opened by the person. */
const FOLLOWED = '[data-slot="work"] details[open][data-working]';
/**
 * Keeps `viewport` at its bottom as it grows while the person has the
 * timeline of work still going on open and was at the bottom, so they watch
 * it come. assistant-ui would stop following once a disclosure in a message opened.
 * Scrolling up lets go; scrolling back to the bottom takes hold again.
 */
export function useFollowWork(
	viewport: RefObject<HTMLDivElement | null>,
): void {
	useLayoutEffect(() => {
		const scroller = viewport.current;
		const content = scroller?.firstElementChild;
		if (scroller == null || content == null) {
			return;
		}
		const bottom = () => scroller.scrollHeight - scroller.clientHeight;
		const atBottom = () => bottom() - scroller.scrollTop <= 1;
		let following = atBottom();
		let top = scroller.scrollTop;
		// Growing never scrolls the thread up, so only the person does.
		const scrolled = () => {
			if (atBottom()) {
				following = true;
			} else if (scroller.scrollTop < top) {
				following = false;
			}
			top = scroller.scrollTop;
		};
		const grew = () => {
			if (following && scroller.querySelector(FOLLOWED) !== null) {
				scroller.scrollTop = bottom();
				top = scroller.scrollTop;
			}
		};
		scroller.addEventListener("scroll", scrolled, { passive: true });
		const watching = new ResizeObserver(grew);
		watching.observe(content);
		return () => {
			scroller.removeEventListener("scroll", scrolled);
			watching.disconnect();
		};
	}, [viewport]);
}
/**
 * Keeps what the person is reading where it is when the thread changes above
 * it, as earlier messages load, an image above comes in or a card above
 * grows, which the browser's own scroll anchoring does not hold here. The
 * place is a `ReadingPlace`: when the thread resizes without scrolling, the
 * thread scrolls by as much as the place drifted. A scroll, by anyone, only
 * takes a new place, so the person's own scroll or a jump to a question or to
 * the latest is never undone. Each message is watched as well as the whole,
 * since the room kept below a turn anchored to the top shrinks by what grows
 * above, and the whole keeps its height. Earlier messages put above are held
 * in the commit that adds them, after assistant-ui's own hold, which puts
 * back the first message and so misses by however far it was stuck.
 */
export function useHoldPlace(viewport: RefObject<HTMLDivElement | null>): void {
	const count = useAuiState((s) => s.thread.messages.length);
	const first = useAuiState((s) => s.thread.messages[0]?.id);
	const watching = useRef<ResizeObserver | null>(null);
	const putBack = useRef<(() => void) | null>(null);
	useLayoutEffect(() => {
		const scroller = viewport.current;
		const content = scroller?.firstElementChild;
		if (scroller == null || content == null) {
			return;
		}
		const place = new ReadingPlace(scroller);
		let top = scroller.scrollTop;
		const take = () => {
			top = scroller.scrollTop;
			place.take();
		};
		const hold = () => {
			const shift = place.drift();
			if (shift !== 0) {
				scroller.scrollTop += shift;
			}
			take();
		};
		const resized = () => {
			if (scroller.scrollTop === top) {
				hold();
			} else {
				take();
			}
		};
		take();
		scroller.addEventListener("scroll", take, { passive: true });
		const observer = new ResizeObserver(resized);
		observer.observe(content);
		watching.current = observer;
		putBack.current = hold;
		return () => {
			scroller.removeEventListener("scroll", take);
			observer.disconnect();
			watching.current = null;
			putBack.current = null;
		};
	}, [viewport]);
	// Runs after assistant-ui's layout effects, the viewport's, in the commit.
	// biome-ignore lint/correctness/useExhaustiveDependencies: again as earlier messages come
	useLayoutEffect(() => {
		putBack.current?.();
	}, [first]);
	// Watching one already watched changes nothing, so each new message only
	// adds itself.
	// biome-ignore lint/correctness/useExhaustiveDependencies: again as messages come
	useLayoutEffect(() => {
		const observer = watching.current;
		for (const message of viewport.current?.querySelectorAll(
			"[data-message-id]",
		) ?? []) {
			observer?.observe(message);
		}
	}, [viewport, count]);
}
/**
 * Reports how many messages the person has read, the most they have scrolled
 * to the foot of in `viewport`: a message counts once its foot clears the
 * composer, and every message before it with it. Settles a moment after the
 * scrolling, and again as the thread unmounts. The last message does not
 * count while it is still being written.
 */
export function useTrackRead(
	viewport: RefObject<HTMLDivElement | null>,
	report: ((read: number) => void) | undefined,
): void {
	const running = useAuiState((s) => s.thread.isRunning);
	const loaded = useAuiState((s) => s.thread.messages.length > 0);
	const last = useRef(0);
	useEffect(() => {
		const scroller = viewport.current;
		if (!loaded || scroller == null || report === undefined) {
			return;
		}
		let timer: ReturnType<typeof setTimeout> | undefined;
		let pending = 0;
		const flush = () => {
			clearTimeout(timer);
			timer = undefined;
			if (pending > last.current) {
				last.current = pending;
				report(pending);
			}
		};
		const measure = () => {
			const bottom =
				scroller.getBoundingClientRect().bottom -
				(Number.parseFloat(scroller.style.scrollPaddingBottom) || 0);
			const messages = [
				...scroller.querySelectorAll<HTMLElement>("[data-message-id]"),
			];
			const final = messages.at(-1);
			for (const message of messages.toReversed()) {
				const index = /^\d+$/.test(message.dataset.messageId ?? "")
					? Number(message.dataset.messageId)
					: Number.NaN;
				if (
					Number.isNaN(index) ||
					(running && message === final) ||
					message.getBoundingClientRect().bottom > bottom + 1
				) {
					continue;
				}
				if (index + 1 > pending) {
					pending = index + 1;
					clearTimeout(timer);
					timer = setTimeout(flush, 600);
				}
				return;
			}
		};
		measure();
		scroller.addEventListener("scroll", measure, { passive: true });
		const content = scroller.firstElementChild;
		const watching = new ResizeObserver(measure);
		if (content !== null) {
			watching.observe(content);
		}
		return () => {
			scroller.removeEventListener("scroll", measure);
			watching.disconnect();
			flush();
		};
	}, [viewport, report, loaded, running]);
}
