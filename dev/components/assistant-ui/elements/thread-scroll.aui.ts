import { type AssistantState, useAuiState } from "@assistant-ui/react";
import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";
import { toCardTop } from "#dev/card-shell.tsx";
import { carriesOn } from "#dev/directives.tsx";

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
/**
 * How far down `element` sits in `scroller`, by layout, as assistant-ui
 * measures, so a fade's slide counts for nothing.
 */
function layoutTop(element: HTMLElement, scroller: HTMLElement): number {
	let top = 0;
	for (
		let at: HTMLElement | null = element;
		at != null && at !== scroller;
		at = at.offsetParent as HTMLElement | null
	) {
		top += at.offsetTop;
	}
	return top;
}
/**
 * Sizes `room`, at the foot of the thread, so `scroller` can scroll `top`
 * to its top. Again until it holds: while the thread is shorter than the
 * viewport, the room it takes first comes out of the space the composer's
 * margin fills.
 */
function makeRoom(scroller: HTMLElement, room: HTMLElement, top: number): void {
	for (let tries = 0; tries < 4; tries++) {
		const rest = scroller.scrollHeight - room.offsetHeight;
		const height = `${Math.max(0, top + scroller.clientHeight - rest)}px`;
		if (room.style.height === height) {
			break;
		}
		room.style.height = height;
	}
}
/**
 * Opens `viewport` at the top of message `at`, the first the person has yet
 * to see, so they read on from where they left off, or else at the top of the
 * card that took the focus as it came up, or else at the bottom, as
 * assistant-ui would. It holds there while what is above settles, as markdown
 * and cards render, until the person scrolls, clicks or types, or a reply
 * starts and `useAnchorAtOnce` takes over.
 */
export function useOpenAt(
	viewport: RefObject<HTMLDivElement | null>,
	at: string | undefined,
): void {
	const loaded = useAuiState((s) => s.thread.messages.length > 0);
	const running = useAuiState((s) => s.thread.isRunning);
	const release = useRef(() => {});
	useLayoutEffect(() => {
		const scroller = viewport.current;
		const content = scroller?.firstElementChild;
		if (!loaded || scroller == null || content == null) {
			return;
		}
		const place = () => {
			const message =
				at === undefined
					? null
					: scroller.querySelector<HTMLElement>(
							`[data-message-id="${CSS.escape(at)}"]`,
						);
			const turn = message?.closest<HTMLElement>('[data-slot="aui_turn"]');
			// A card that took the focus as it came up, as questions do.
			const arrived =
				document.activeElement?.closest<HTMLElement>("[data-card]");
			if (
				(message == null || turn == null) &&
				arrived != null &&
				scroller.contains(arrived)
			) {
				toCardTop(arrived);
			} else if (message == null || turn == null) {
				scroller.scrollTop = scroller.scrollHeight;
			} else if (message === turn.firstElementChild) {
				// The person's message that opens a turn reads from the turn's top.
				scroller.scrollTop = layoutTop(turn, scroller);
			} else {
				toCardTop(message);
			}
		};
		place();
		// Again once the parts assistant-ui renders through a renderer, as a
		// card is, have come: it registers them a commit late.
		const frame = requestAnimationFrame(place);
		const watching = new ResizeObserver(place);
		watching.observe(scroller);
		watching.observe(content);
		const gestures = ["pointerdown", "wheel", "touchstart", "keydown"];
		const stop = () => {
			cancelAnimationFrame(frame);
			watching.disconnect();
			for (const gesture of gestures) {
				scroller.removeEventListener(gesture, stop);
			}
		};
		for (const gesture of gestures) {
			scroller.addEventListener(gesture, stop, { passive: true });
		}
		release.current = stop;
		return stop;
	}, [loaded, at, viewport]);
	useEffect(() => {
		if (running) {
			release.current();
		}
	}, [running]);
}
/**
 * The person's message that opens the turn assistant-ui anchors to the top:
 * the one before the last, a reply, while it runs. None for a bare line, as a
 * checkpoint is, which carries on the turn it comes in.
 */
const anchoredTurn = (s: AssistantState) => {
	const { messages, isRunning } = s.thread;
	const anchor = messages.at(-2);
	return isRunning &&
		anchor?.role === "user" &&
		!carriesOn(anchor) &&
		messages.at(-1)?.role === "assistant"
		? anchor.id
		: undefined;
};
/**
 * No message is too tall to anchor by its top. assistant-ui would scroll past
 * the top of a tall one, leaving only its foot in view, but ours stays stuck
 * atop its turn whole, so the reply would only scroll behind it.
 */
export const UNCLAMPED = { tallerThan: `${Number.MAX_SAFE_INTEGER}px` };
/** The spacer assistant-ui keeps below a turn anchored to the top. */
const RESERVE = "[data-aui-top-anchor-reserve]";
/**
 * Anchors a new turn to the top of `viewport` in the commit that adds it, as
 * assistant-ui would a frame or two later: its spacer moved below the reply
 * and sized to let the person's message reach the top, and the scroll there.
 * Left to assistant-ui, every frame in between paints the message somewhere
 * else first. Its own pass then finds nothing left to do.
 */
export function useAnchorAtOnce(
	viewport: RefObject<HTMLDivElement | null>,
): void {
	const id = useAuiState(anchoredTurn);
	useLayoutEffect(() => {
		const scroller = viewport.current;
		const anchor = scroller?.querySelector<HTMLElement>(
			`[data-role="user"][data-message-id="${CSS.escape(id ?? "")}"]`,
		);
		const target = anchor?.nextElementSibling;
		if (
			id === undefined ||
			scroller == null ||
			anchor == null ||
			!(target instanceof HTMLElement)
		) {
			return;
		}
		// Before assistant-ui has anchored a turn here it has no spacer, and
		// its own comes a frame later: a stand-in holds the room until then.
		// assistant-ui keeps its spacer by reference, so it would never take
		// one made here for its own.
		const found = scroller.querySelector<HTMLElement>(RESERVE);
		const reserve = found ?? document.createElement("div");
		if (found === null) {
			reserve.setAttribute("aria-hidden", "true");
			reserve.style.flexShrink = "0";
			reserve.style.pointerEvents = "none";
		}
		target.after(reserve);
		const scrollTop = layoutTop(anchor, scroller);
		// As assistant-ui sizes it frame by frame.
		makeRoom(scroller, reserve, scrollTop);
		const ratio = window.devicePixelRatio || 1;
		scroller.scrollTop = Math.round(scrollTop * ratio) / ratio;
		if (found !== null) {
			return;
		}
		// Its spacer comes empty, the stand-in already making the room: the
		// stand-in hands it the room before the frame paints.
		let frame = 0;
		const handOver = () => {
			const theirs = scroller.querySelector<HTMLElement>(RESERVE);
			if (theirs === null) {
				frame = requestAnimationFrame(handOver);
				return;
			}
			theirs.style.height = reserve.style.height;
			reserve.remove();
		};
		frame = requestAnimationFrame(handOver);
		return () => {
			cancelAnimationFrame(frame);
			reserve.remove();
		};
	}, [id, viewport]);
}
