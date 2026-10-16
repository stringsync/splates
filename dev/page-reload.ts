import { useDisposerEffect } from "@webappwiz/react";
import { Disposer, type Resource } from "webappwiz/disposable";
import type { Drafts } from "./drafts";
import type { Feed } from "./feed";

/** The tag in the shell that names the build of the page this tab loaded. */
const META = "arbor-page";

/** The version of the page this tab loaded, or null outside a served page. */
export function loadedPage(doc: Document = document): string | null {
	return (
		doc.querySelector(`meta[name="${META}"]`)?.getAttribute("content") ?? null
	);
}

/**
 * Reloads the tab once the server says it rebuilt the page, but never over a
 * draft: while one is typed it waits, and reloads as the last one is sent or
 * cleared. A tab that already holds the page named asks nothing.
 */
export class PageReload implements Resource {
	private latest: string | null = null;
	private readonly disposer = new Disposer();

	constructor(
		feed: Pick<Feed, "events">,
		private readonly drafts: Drafts,
		private readonly loaded: string | null,
		private readonly page: { reload(): void },
	) {
		this.disposer.defer(
			feed.events.on("page", (version) => {
				this.latest = version;
				this.check();
			}),
		);
		this.disposer.defer(drafts.events.on("written", () => this.check()));
	}

	dispose(): void {
		this.disposer.dispose();
	}

	private check(): void {
		if (
			this.latest !== null &&
			this.latest !== this.loaded &&
			!this.drafts.typed()
		) {
			this.latest = null;
			this.page.reload();
		}
	}
}

/** Keeps the tab on the page the server serves, as `PageReload` does. */
export function usePageReload(feed: Feed, drafts: Drafts): void {
	useDisposerEffect(
		(disposer) => {
			disposer.use(new PageReload(feed, drafts, loadedPage(), window.location));
		},
		[feed, drafts],
	);
}
