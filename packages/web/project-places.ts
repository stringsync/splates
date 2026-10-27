/**
 * Where the page goes to show a project, and where this tab last was in
 * each: none of it hangs on the projects being listed.
 */

import { useEffect } from "react";

/** The project the address names: `?project=`, or none for the focused one. */
export function shownProject(): string | null {
	return new URLSearchParams(location.search).get("project") || null;
}

/** The slug of the focused project once a snapshot says it, which the bare address never does. */
let focused: string | null = null;

/** Records the slug of the project the bare address shows. */
export function knowFocused(slug: string): void {
	focused = slug;
}

/** What `rememberPlace` files the project shown by `shownProject` under. */
export function placeKey(project: string | null): string {
	return project ?? focused ?? "";
}

/** Where this tab last was in each project, by slug, "" for the focused one. */
const PLACES = "splates.places";

/** A project as this tab last showed it: its name, and the address's hash. */
interface Place {
	name?: string;
	hash?: string;
}

function places(): Record<string, Place> {
	try {
		const read: unknown = JSON.parse(sessionStorage.getItem(PLACES) ?? "{}");
		return typeof read === "object" && read !== null
			? (read as Record<string, Place>)
			: {};
	} catch {
		return {};
	}
}

/** Where `project`, a slug or "" for the focused one, was last left. */
export function placeOf(project: string): Place {
	return places()[project] ?? {};
}

/** Keeps `place` for `project`, over what was kept for it before. */
export function rememberPlace(project: string, place: Place): void {
	const all = places();
	all[project] = { ...all[project], ...place };
	sessionStorage.setItem(PLACES, JSON.stringify(all));
}

/** The project this tab showed before the one it shows, by slug. */
const PREVIOUS = "splates.previousProject";

/** The project this tab showed last before this one, by slug; null for none yet. */
export function previousProject(): string | null {
	try {
		return sessionStorage.getItem(PREVIOUS) || null;
	} catch {
		return null;
	}
}

/** Keeps `project`, the one the tab leaves, for the switcher to offer first. */
export function rememberPrevious(project: string): void {
	if (project === "") {
		return;
	}
	try {
		sessionStorage.setItem(PREVIOUS, project);
	} catch {
		// Storage refused: the switcher offers no project first.
	}
}

/**
 * Where the page goes to show `project`, named by its slug, so the address
 * keeps showing it whatever is focused later: where this tab last left it,
 * else the same page of it, and none of the last project's conversations,
 * which are its own. With `stay`, the same page, at its top: the system or
 * cred it was on is the last project's. Likewise from any page but the
 * conversations, the board included.
 */
export function projectUrl(
	project: { slug: string },
	{ stay = false }: { stay?: boolean } = {},
): string {
	const url = new URL(location.href);
	url.searchParams.set("project", project.slug);
	const { hash } = placeOf(project.slug);
	// Off the conversations, the page is the project's own view of something
	// (board, tasks, queue, stats): the switch keeps to it rather than to a
	// place.
	const onConversations = url.hash.startsWith("#conversations");
	if (url.hash === "" || url.hash.startsWith("#lanes/")) {
		// The board, which the bare address is; named, since a phone opens
		// its inbox on a bare address, as the switch's new page is.
		url.hash = "#todos";
	} else if (stay || !onConversations) {
		url.hash = url.hash.split("/")[0] ?? "";
	} else if (hash !== undefined) {
		url.hash = hash;
	} else if (url.hash.startsWith("#conversations/")) {
		url.hash = "#conversations";
	}
	return url.toString();
}

/**
 * The project's name, `repo` once the snapshot gives it. Before the first
 * snapshot, the name this tab last saw the project by, else the one the
 * address names, so a switch heads the page with where it is going rather
 * than "splates".
 */
export function useProjectName(
	repo: string | undefined,
	slug?: string,
): string {
	const project = shownProject() ?? "";
	useEffect(() => {
		if (project === "" && slug !== undefined) {
			knowFocused(slug);
		}
	}, [project, slug]);
	useEffect(() => {
		if (repo !== undefined) {
			rememberPlace(project, { name: repo });
		}
	}, [repo, project]);
	return repo ?? placeOf(project).name ?? (project || "Spinning Plates");
}
