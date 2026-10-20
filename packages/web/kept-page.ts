import type { Snapshot } from "@stringsync/splates-server/tasks";
import { SystemTimer, type Timer } from "webappwiz/time";
import type { Listing } from "./conversation-feed";
import { IndexedPageCopies, type PageCopies } from "./page-copies";
import { PageCopy } from "./page-copy";

/**
 * What the page keeps of a project, its snapshot and its conversation
 * listing, for its feeds to draw from at once when it is opened again. Make
 * one as the page makes the project's feeds.
 */
export class KeptPage {
	private constructor(
		readonly snapshot: PageCopy<Snapshot>,
		readonly listing: PageCopy<Listing>,
	) {}

	/**
	 * Keeps `project`'s, a slug or "" for the focused one, in `copies`,
	 * IndexedDB when not given, where there is one; null when there is
	 * nowhere to keep them.
	 */
	static open(
		project: string,
		copies: PageCopies | null | undefined,
		timer: Timer = new SystemTimer(),
	): KeptPage | null {
		const store =
			copies !== undefined
				? copies
				: typeof indexedDB === "undefined"
					? null
					: new IndexedPageCopies(indexedDB);
		if (store === null) {
			return null;
		}
		return new KeptPage(
			new PageCopy(store, `snapshot ${project}`, timer),
			new PageCopy(store, `conversations ${project}`, timer),
		);
	}
}
