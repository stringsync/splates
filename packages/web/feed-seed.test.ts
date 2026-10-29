import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { FakeTimer } from "webappwiz/time/testing";
import { FakePageCopies } from "./fake-page-copies";
import { Feed } from "./feed";
import { PageCopy } from "./page-copy";
import { details, snapshot, todo } from "./testing";

describe("Feed's seed", () => {
	const fetched = globalThis.fetch;
	const Source = globalThis.EventSource;
	let feed: Feed;

	beforeEach(() => {
		globalThis.fetch = (async () =>
			Response.json(
				snapshot({ todos: [todo({ subject: "Own" })] }),
			)) as unknown as typeof fetch;
		globalThis.EventSource = class {
			addEventListener(): void {}
			close(): void {}
		} as unknown as typeof EventSource;
		feed = new Feed({ project: "shop" });
	});

	afterEach(() => {
		feed.dispose();
		globalThis.fetch = fetched;
		globalThis.EventSource = Source;
	});

	it("shows the seed, as one, until the project's own snapshot arrives", async () => {
		const seed = snapshot({ repo: "shop" });
		feed.seed(seed);
		expect(feed.snapshot).toBe(seed);
		expect(feed.seeded).toBe(true);

		feed.start();

		await Bun.sleep(0);
		expect(feed.snapshot?.todos.map((each) => each.subject)).toEqual(["Own"]);
		expect(feed.seeded).toBe(false);
	});

	it("shows a whole seed as the project's own", () => {
		feed.seed(snapshot({ repo: "shop" }), { whole: true });

		expect(feed.seeded).toBe(false);
	});

	it("drops the seed of a project the server has not got", async () => {
		globalThis.fetch = (async () =>
			Response.json(
				{ reason: "not_found", message: "no project shop" },
				{ status: 404 },
			)) as unknown as typeof fetch;
		feed.seed(snapshot({ repo: "shop" }));

		feed.start();

		await Bun.sleep(0);
		expect(feed.snapshot).toBeNull();
		expect(feed.missing).toBe("no project shop");
	});

	it("keeps what it read over a later seed", async () => {
		feed.start();
		await Bun.sleep(0);

		feed.seed(snapshot({ repo: "other" }));

		expect(feed.snapshot?.todos.map((each) => each.subject)).toEqual(["Own"]);
		expect(feed.seeded).toBe(false);
	});

	it("fills a seed from the snapshot last kept, under the seed's newer tasks", async () => {
		globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch;
		const copies = new FakePageCopies();
		copies.save("snapshot shop", {
			version: 1,
			value: snapshot({
				todos: [todo({ subject: "Kept" })],
				tasks: [details({ task: "old" })],
			}),
		});
		const kept = new Feed({
			copy: new PageCopy(copies, "snapshot shop", new FakeTimer()),
			project: "shop",
		});
		kept.seed(snapshot({ tasks: [details({ task: "new" })] }));

		kept.start();

		await Bun.sleep(0);
		expect(kept.snapshot?.todos.map((each) => each.subject)).toEqual(["Kept"]);
		expect(kept.snapshot?.tasks.map((each) => each.task)).toEqual(["new"]);
		expect(kept.seeded).toBe(false);
		kept.dispose();
	});
});
