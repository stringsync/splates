import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { EverywhereProject } from "@stringsync/splates-server/projects";
import type { Resource } from "webappwiz/disposable";
import { FakeTimer } from "webappwiz/time/testing";
import { EverywhereFeed } from "./everywhere-feed";
import { FakePageCopies } from "./fake-page-copies";
import { PageCopy } from "./page-copy";
import { conversation } from "./testing";

describe("EverywhereFeed's kept copy", () => {
	const fetched = globalThis.fetch;
	const Source = globalThis.EventSource;
	/** Each listing asked for and not yet answered, in the order asked. */
	let listings: ((response: Response) => void)[];
	let copies: FakePageCopies;
	let timer: FakeTimer;
	let feed: EverywhereFeed;
	let held: Resource;

	const project = (slug: string, ids: string[]): EverywhereProject => ({
		project: slug,
		repo: slug,
		root: `/code/${slug}`,
		trunk: "main",
		tasks: [],
		laneNames: [],
		worktreeRoot: "/code/worktrees",
		lanesTaken: {},
		conversations: ids.map((id) => conversation({ id })),
	});

	beforeEach(() => {
		listings = [];
		globalThis.fetch = (() =>
			new Promise<Response>((resolve) =>
				listings.push(resolve),
			)) as unknown as typeof fetch;
		globalThis.EventSource = class {
			onmessage = null;
			onopen: (() => void) | null = null;
			constructor() {
				// Open at once, as the server's is, so the feed lists.
				queueMicrotask(() => this.onopen?.());
			}
			addEventListener(): void {}
			close(): void {}
		} as unknown as typeof EventSource;
		copies = new FakePageCopies();
		timer = new FakeTimer();
		feed = new EverywhereFeed({
			copy: new PageCopy(copies, "everywhere", timer),
		});
	});

	afterEach(() => {
		held?.dispose();
		globalThis.fetch = fetched;
		globalThis.EventSource = Source;
	});

	const slugs = () => feed.conversations.map((each) => each.project);

	it("draws every project from the copy last kept until the server lists them", async () => {
		copies.save("everywhere", {
			build: "",
			value: { projects: [project("api", ["a1"]), project("web", ["w1"])] },
		});
		held = feed.hold();
		await settled();
		expect(feed.loading).toBe(false);
		expect(feed.available).toBe(true);
		expect(slugs()).toEqual(["api", "web"]);

		listings.shift()?.(Response.json({ projects: [project("web", ["w2"])] }));
		await settled();
		expect(feed.conversations.map((each) => each.id)).toEqual(["w2"]);
	});

	it("keeps what the server lists for the next page", async () => {
		held = feed.hold();
		await settled();
		listings.shift()?.(Response.json({ projects: [project("api", ["a1"])] }));
		await settled();
		expect(copies.kept.has("everywhere")).toBe(false);

		timer.fireTimeouts();

		const kept = copies.kept.get("everywhere") as {
			value: { projects: EverywhereProject[] };
		};
		expect(kept.value.projects.map((each) => each.project)).toEqual(["api"]);
	});

	it("gives up the copy once the server refuses every project, as through a tunnel with no Access", async () => {
		copies.save("everywhere", {
			build: "",
			value: { projects: [project("api", ["a1"])] },
		});
		held = feed.hold();
		await settled();
		expect(feed.available).toBe(true);

		listings.shift()?.(new Response(null, { status: 403 }));
		await settled();

		expect(feed.available).toBe(false);
		expect(feed.loading).toBe(false);
		expect(feed.conversations).toEqual([]);
	});

	it("keeps the copy while the server cannot be reached", async () => {
		copies.save("everywhere", {
			build: "",
			value: { projects: [project("api", ["a1"])] },
		});
		globalThis.fetch = (() =>
			Promise.reject(new TypeError("no server"))) as unknown as typeof fetch;
		held = feed.hold();
		await settled();

		expect(feed.available).toBe(true);
		expect(feed.loading).toBe(false);
		expect(slugs()).toEqual(["api"]);
	});
});

async function settled(): Promise<void> {
	for (let turn = 0; turn < 10; turn++) {
		await Promise.resolve();
	}
}
