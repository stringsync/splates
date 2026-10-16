/**
 * Where the page goes to show a project, and where this tab last was in
 * each: none of it hangs on the projects being listed.
 */

/** The project the address names: `?project=`, or none for the focused one. */
export function shownProject(): string | null {
	return new URLSearchParams(location.search).get("project") || null;
}

/** Where this tab last was in each project, by slug, "" for the focused one. */
const PLACES = "arbor.places";

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

/**
 * Where the page goes to show `project`, named by its slug, so the address
 * keeps showing it whatever is focused later: where this tab last left it,
 * else the same page of it, and none of the last project's conversations,
 * which are its own.
 */
export function projectUrl(project: { slug: string }): string {
	const url = new URL(location.href);
	url.searchParams.set("project", project.slug);
	const { hash } = placeOf(project.slug);
	if (hash !== undefined) {
		url.hash = hash;
	} else if (url.hash.startsWith("#conversations/")) {
		url.hash = "#conversations";
	}
	return url.toString();
}
