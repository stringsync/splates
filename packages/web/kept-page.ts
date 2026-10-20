import type { Snapshot } from "@stringsync/splates-server/tasks";
import { SystemTimer, type Timer } from "webappwiz/time";
import type { Listing } from "./conversation-feed";
import { IndexedPageCopies, type PageCopies } from "./page-copies";
import { PageCopy } from "./page-copy";
import { shownProject } from "./project-places";

/**
 * What the page keeps of the project the address names, its snapshot and its
 * conversation listing, for its feeds to draw from at once when it is opened
 * again. Make one as the page for a project mounts.
 */
export class KeptPage {
	private constructor(
		readonly snapshot: PageCopy<Snapshot>,
		readonly listing: PageCopy<Listing>,
	) {}

	/**
	 * Keeps them in `copies`, IndexedDB when not given, where there is one;
	 * null when there is nowhere to keep them.
	 */
	static open(
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
		const project = shownProject() ?? "";
		return new KeptPage(
			new PageCopy(store, `snapshot ${project}`, timer),
			new PageCopy(store, `conversations ${project}`, timer),
		);
	}
}
