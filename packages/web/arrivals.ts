import { useEffect, useEffectEvent } from "react";
import { toCardTop } from "./card-shell";

/**
 * The cards an agent waits on you through, newest last: its questions, a
 * review, a live ask, or in a conversation from before escalating was
 * retired, an escalation.
 */
const WAITING_CARDS = [
	'section[aria-label="questions for you"]',
	'section[aria-label^="escalated "]',
	'section[aria-label^="review "]',
	'[aria-label="permission"]',
	'form[aria-label="question"]',
].join(", ");

/**
 * Scrolls to the top of the newest card in `within` that an agent waits on
 * you through and focuses its first stop, false when there is none.
 */
export function toWaiting(within: HTMLElement | null): boolean {
	const cards = within?.querySelectorAll<HTMLElement>(WAITING_CARDS) ?? [];
	const card = cards[cards.length - 1];
	if (card === undefined) {
		return false;
	}
	const stop = card.querySelector<HTMLElement>(
		"[data-stop], textarea, input, button:not([disabled])",
	);
	toCardTop(card, "smooth");
	stop?.focus({ preventScroll: true });
	return true;
}

/**
 * Where ⌥⌘M, which opens the next agent waiting on you, and the view that
 * shows that agent meet: the agent it opened last, until its view goes to
 * what it waits on you for.
 */
const arrivals = new EventTarget();
let opening: { open: string; from: string } | null = null;

/**
 * Goes to what agent `open` waits on you for once its view shows, from the
 * address the page is at, which is where to come back to.
 */
export function arriveAt(open: string): void {
	opening = { open, from: location.hash };
	arrivals.dispatchEvent(new Event("arrive"));
}

/**
 * Runs `go` once ⌥⌘M opens agent `open`: as its view shows, or at once
 * when it already does, with the address it came from.
 */
export function useArrived(open: string, go: (from: string) => void): void {
	const arrive = useEffectEvent(() => {
		if (opening?.open === open) {
			const { from } = opening;
			opening = null;
			go(from);
		}
	});
	useEffect(() => {
		arrive();
		arrivals.addEventListener("arrive", arrive);
		return () => arrivals.removeEventListener("arrive", arrive);
	}, []);
}
