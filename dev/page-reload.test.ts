import { describe, expect, it } from "bun:test";
import { Dispatcher } from "webappwiz/events";
import { Drafts } from "./drafts";
import type { FeedEvents } from "./feed";
import { PageReload } from "./page-reload";

/** A feed that says what it is told, and a tab that counts its reloads. */
function open(loaded: string | null) {
	const dispatcher = new Dispatcher<FeedEvents>();
	const drafts = new Drafts();
	const page = {
		reloads: 0,
		reload() {
			this.reloads++;
		},
	};
	const reload = new PageReload(
		{ events: dispatcher.events },
		drafts,
		loaded,
		page,
	);
	return { dispatcher, drafts, page, reload };
}

describe("PageReload", () => {
	it("reloads at once when a new page is ready and no draft is typed", () => {
		const { dispatcher, page } = open("a");

		dispatcher.dispatch("page", "b");

		expect(page.reloads).toBe(1);
	});

	it("leaves a tab alone that already holds the page", () => {
		const { dispatcher, page } = open("a");

		dispatcher.dispatch("page", "a");

		expect(page.reloads).toBe(0);
	});

	it("waits while a draft is typed, then reloads once it is sent", () => {
		const { dispatcher, drafts, page } = open("a");
		drafts.write("c1", "half a thought");

		dispatcher.dispatch("page", "b");
		expect(page.reloads).toBe(0);

		drafts.write("c1", "");
		expect(page.reloads).toBe(1);
	});

	it("reloads only once", () => {
		const { dispatcher, drafts, page } = open("a");

		dispatcher.dispatch("page", "b");
		drafts.write("c1", "x");
		drafts.write("c1", "");

		expect(page.reloads).toBe(1);
	});
});
