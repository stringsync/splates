import type { TriggerAdapter, TriggerItem } from "@assistant-ui/react";
import { useContext, useRef, useState } from "react";
import { ThreadExtrasContext } from "#dev/components/assistant-ui/elements/thread-context.aui.ts";
import { serialize } from "./composer-chips";
import { type Pick, pathPicks, type Source, type Sources } from "./mentions";
import type { References } from "./references";

/**
 * The categories of the composer's `#` a plain box offers too: what an
 * answer can point at. A directive is a whole message's, and an action runs
 * rather than writes.
 */
const POINTED_AT = new Set([
	"todo",
	"lane",
	"task",
	"system",
	"project",
	"conversation",
]);

/**
 * What `@` and `#` offer in a plain box inside a thread, such as a card's
 * answer: the thread's own, as its composer offers them, written as the
 * composer's chips are sent; nothing outside a thread. The same sources
 * for the box's life, each searching what the thread offers as it is typed
 * in, so the board changing keeps the list where it is.
 */
export function useThreadSources(): Sources {
	const extras = useContext(ThreadExtrasContext);
	const latest = useRef(extras);
	latest.current = extras;
	const [sources] = useState<Sources>(() => ({
		"@": paths(() => latest.current.mentions),
		"#": pointers(() => latest.current.references),
	}));
	return sources;
}

function paths(adapter: () => TriggerAdapter | undefined): Source {
	return {
		search: (query) =>
			pathPicks((adapter()?.search?.(query) ?? []).map((item) => item.id)),
	};
}

/**
 * What `#` points at, those whose label starts with what was typed first,
 * then those whose label holds it, then those whose description does, such
 * as a todo's `#12` or a system's alias, each in the composer's order.
 */
function pointers(offered: () => References | undefined): Source {
	return {
		search: (query) => {
			const references = offered();
			if (references === undefined) {
				return [];
			}
			const typed = query.toLowerCase();
			const items = references.adapter
				.categories()
				.filter(({ id }) => POINTED_AT.has(id))
				.flatMap(({ id }) => references.adapter.categoryItems(id));
			const scored: { item: TriggerItem; score: number }[] = [];
			for (const item of items) {
				const label = item.label.toLowerCase();
				const score = label.startsWith(typed)
					? 0
					: label.includes(typed)
						? 1
						: (item.description?.toLowerCase().includes(typed) ?? false)
							? 2
							: null;
				if (score !== null) {
					scored.push({ item, score });
				}
			}
			return scored
				.sort((left, right) => left.score - right.score)
				.flatMap(({ item }) => pick(references, item));
		},
	};
}

function pick(references: References, item: TriggerItem): Pick[] {
	const chip = references.chip(item);
	return chip === null
		? []
		: [
				{
					id: item.id,
					label: item.label,
					description: item.description,
					icon: references.icon(item),
					written: `${serialize(chip)} `,
				},
			];
}
