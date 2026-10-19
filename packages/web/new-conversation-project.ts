/**
 * Which project a new conversation starts in: the page's, which a pick above
 * the composer switches, and for New, the last one a conversation started in.
 */

import { createContext, useContext } from "react";
import { NEW } from "./conversation-address";
import { NavigationContext } from "./navigation";
import { laneAddress } from "./page-address";
import { listProjects } from "./project-api";
import { shownProject } from "./project-places";

/** Where the project last used for a new conversation is kept. */
const LAST = "splates.newConversationProject";

/** Where whether the last conversation started was on Auto pick is kept. */
const LAST_AUTO = "splates.newConversationAuto";

/** A project a new conversation was started or picked in. */
export interface UsedProject {
	slug: string;
	/** Its main tree, which tells it from the focused one an address names none for. */
	root: string;
}

/** The project a new conversation last started in, or was picked for. */
export function lastProject(): UsedProject | null {
	try {
		const read: unknown = JSON.parse(localStorage.getItem(LAST) ?? "null");
		return typeof read === "object" &&
			read !== null &&
			"slug" in read &&
			"root" in read &&
			typeof read.slug === "string" &&
			typeof read.root === "string"
			? { slug: read.slug, root: read.root }
			: null;
	} catch {
		return null;
	}
}

/** Keeps `project` as the one New starts in next. */
export function rememberProject({ slug, root }: UsedProject): void {
	try {
		localStorage.setItem(LAST, JSON.stringify({ slug, root }));
	} catch {
		// Storage refused, as in a private window: New stays in the page's.
	}
}

/**
 * Keeps the project the page shows, at `root`, as the one New starts in
 * next: by the slug the address names, else the focused one's, once listed.
 */
export function rememberShown(root: string): void {
	const slug = shownProject();
	if (slug !== null) {
		rememberProject({ slug, root });
		return;
	}
	void listProjects().then(
		({ projects }) => {
			const found = projects.find((each) => each.root === root);
			if (found !== undefined) {
				rememberProject(found);
			}
		},
		() => {},
	);
}

/** Whether the last conversation started was on Auto pick, so New starts there too. */
export function lastStartedAuto(): boolean {
	try {
		return localStorage.getItem(LAST_AUTO) === "true";
	} catch {
		return false;
	}
}

/** Keeps whether the conversation just started was on Auto pick, for New to follow. */
export function rememberAuto(auto: boolean): void {
	try {
		localStorage.setItem(LAST_AUTO, String(auto));
	} catch {
		// Storage refused: New starts with the newest conversation's agent.
	}
}

/** Stops New starting in `slug`, a project forgotten. */
export function forgetUsed(slug: string): void {
	if (lastProject()?.slug === slug) {
		try {
			localStorage.removeItem(LAST);
		} catch {
			// Storage refused: there was nothing kept to forget.
		}
	}
}

/**
 * The address of the screen that starts a conversation in the project
 * `slug` names, `open` its place under `#conversations/`, as `new/codex`.
 * Show it with `NavigationContext`'s `show`, which draws that project's page
 * in place.
 */
export function newConversationUrl(slug: string, open: string = NEW): string {
	const url = new URL(location.href);
	url.searchParams.set("project", slug);
	url.hash = `#conversations/${open}`;
	return url.toString();
}

/** The address of project `slug`'s board, opened on lane `id`. */
export function laneUrl(slug: string, id: number): string {
	const url = new URL(location.href);
	url.searchParams.set("project", slug);
	url.hash = laneAddress(id);
	return url.toString();
}

/** The main tree of the project the page shows, null before its first snapshot. */
export const ShownRoot = createContext<string | null>(null);

/**
 * Opens the screen that starts a conversation, `open` under
 * `#conversations/`, in the last project used: through `onOpen` when that is
 * the page's, else by showing that project's page.
 */
export function useOpenNew(
	onOpen: (open: string) => void,
): (open?: string) => void {
	const navigation = useContext(NavigationContext);
	const root = useContext(ShownRoot);
	return (open = NEW) => {
		const last = lastProject();
		if (
			last === null ||
			root === null ||
			last.root === root ||
			last.slug === shownProject()
		) {
			onOpen(open);
		} else {
			navigation.show(newConversationUrl(last.slug, open));
		}
	};
}
