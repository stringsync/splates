import { createContext, useSyncExternalStore } from "react";
import {
	placeKey,
	rememberPlace,
	rememberPrevious,
	shownProject,
} from "./project-places";

/** Where the page goes to another address, which tests fake. */
export interface Navigation {
	/** Leaves this page for the one at `url`. */
	go(url: string): void;
	/**
	 * Shows `url`, another project's address on this page, without leaving
	 * it: the page draws that project in place, as if it had loaded there.
	 */
	show(url: string): void;
}

/** Told whenever `show` moves the address, which `popstate` never says. */
const SHOWN = new Set<() => void>();

/**
 * Moves the address to `url` in an entry of its own, and has the page draw
 * the project it names; an address of another page is left for, as `go` does.
 */
export function showAddress(url: string): void {
	const next = new URL(url, location.href);
	if (next.origin !== location.origin || next.pathname !== location.pathname) {
		location.assign(next);
		return;
	}
	// So coming back to the project left lands where it was, however it was left.
	const leaving = shownProject();
	if ((next.searchParams.get("project") || null) !== leaving) {
		rememberPlace(placeKey(leaving), { hash: location.hash });
		rememberPrevious(placeKey(leaving));
	}
	// The scroll to come back to, as `PageAddress` keeps it; and no `back`,
	// so the page's own back button never steps out of the project.
	history.replaceState({ ...history.state, scroll: scrollY }, "");
	history.pushState({ at: next.hash, scroll: 0 }, "", next);
	for (const changed of [...SHOWN]) {
		changed();
	}
}

/**
 * The project the address names, `?project=`, or null for the focused one,
 * following `show` and the browser's back and forward.
 */
export function useShownProject(): string | null {
	return useSyncExternalStore(follow, shownProject);
}

/** Calls `changed` each time `show` moves the address, until the returned stop. */
export function followShown(changed: () => void): () => void {
	SHOWN.add(changed);
	return () => SHOWN.delete(changed);
}

function follow(changed: () => void): () => void {
	const unfollow = followShown(changed);
	window.addEventListener("popstate", changed);
	return () => {
		unfollow();
		window.removeEventListener("popstate", changed);
	};
}

/** The browser's own navigation, unless a provider gives another. */
export const NavigationContext = createContext<Navigation>({
	go: (url) => location.assign(url),
	show: showAddress,
});
