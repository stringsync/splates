import { useDisposerEffect, useReactive } from "@webappwiz/react";
import { createContext, useContext } from "react";
import { EverywhereFeed } from "./everywhere-feed";

/**
 * The page's one feed of every project, held above `App` so a switch of
 * project leaves it streaming. A test passes its own; one left without
 * shares this, which streams only once something reads it.
 */
export const EverywhereContext = createContext<EverywhereFeed>(
	new EverywhereFeed(),
);

/**
 * What `select` reads of every project's tasks and conversations, kept
 * streaming while the component is mounted.
 */
export function useEverywhere<State>(
	select: (feed: EverywhereFeed) => State,
): State {
	const feed = useContext(EverywhereContext);
	useDisposerEffect((disposer) => disposer.use(feed.hold()), [feed]);
	return useReactive(feed, select, ["changed"]);
}
