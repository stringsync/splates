import { Duration } from "core/time";
import { useEffect, useRef, useState } from "react";
import type { ConversationFeed } from "./conversation-feed";

/**
 * Splits `items` into those sent under `after` ago and those held longer, by
 * `sentAt` (epoch ms; null counts as held), and renders again as the next one
 * ages.
 */
export function useAged<T>(
	feed: ConversationFeed,
	items: readonly T[],
	sentAt: (item: T) => number | null,
	after: Duration,
): { young: T[]; aged: T[] } {
	const [, tick] = useState(0);
	const now = feed.wall.now();
	const young: T[] = [];
	const aged: T[] = [];
	let next = Number.POSITIVE_INFINITY;
	for (const item of items) {
		const at = sentAt(item);
		const due = at === null ? 0 : at + after.ms;
		if (due > now) {
			young.push(item);
			next = Math.min(next, due);
		} else {
			aged.push(item);
		}
	}
	// The same arrays while nothing moved, so what depends on them is left be.
	const held = useRef({ young, aged });
	const same = (before: readonly T[], now: readonly T[]) =>
		before.length === now.length &&
		before.every((each, at) => each === now[at]);
	if (!same(held.current.young, young) || !same(held.current.aged, aged)) {
		held.current = { young, aged };
	}
	useEffect(() => {
		if (next === Number.POSITIVE_INFINITY) {
			return;
		}
		const timer = feed.timer.setTimeout(
			() => tick((times) => times + 1),
			Duration.ms(Math.max(0, next - feed.wall.now())),
		);
		return () => timer.dispose();
	}, [feed, next]);
	return held.current;
}
