import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { EverywhereProject } from "@stringsync/splates-server/projects";
import type { Resource } from "webappwiz/disposable";
import { EverywhereFeed } from "./everywhere-feed";
import { conversation, details } from "./testing";

/** The stream the feed opened, to say what the server would. */
interface Stream {
	url: string;
	onmessage: ((event: { data: string }) => void) | null;
	onopen: (() => void) | null;
	named: Map<string, (event: { data: string }) => void>;
	closed: boolean;
}

describe("EverywhereFeed", () => {
	const fetched = globalThis.fetch;
	const Source = globalThis.EventSource;
	/** Each listing asked for and not yet answered, in the order asked. */
	let listings: ((projects: EverywhereProject[]) => void)[];
	let streams: Stream[];
	let feed: EverywhereFeed;
	let held: Resource;

	beforeEach(() => {
		listings = [];
		streams = [];
		globalThis.fetch = (() => {
			return new Promise<Response>((resolve) =>
				listings.push((projects) => resolve(Response.json({ projects }))),
			);
		}) as unknown as typeof fetch;
		globalThis.EventSource = class {
			onmessage = null;
			onopen = null;
			closed = false;
			readonly named = new Map();
			constructor(readonly url: string) {
				streams.push(this);
			}
			addEventListener(
				name: string,
				listener: (event: { data: string }) => void,
			): void {
				this.named.set(name, listener);
			}
			close(): void {
				this.closed = true;
			}
		} as unknown as typeof EventSource;
		feed = new EverywhereFeed();
	});

	afterEach(() => {
		held?.dispose();
		globalThis.fetch = fetched;
		globalThis.EventSource = Source;
	});

	const project = (
		slug: string,
		overrides: Partial<EverywhereProject> = {},
	): EverywhereProject => ({
		project: slug,
		repo: slug,
		root: `/code/${slug}`,
		trunk: "main",
		tasks: [],
		laneNames: [],
		conversations: [],
		...overrides,
	});

	/** Opens the stream, which lists every project, and answers with `projects`. */
	async function open(projects: EverywhereProject[]): Promise<void> {
		streams.at(-1)?.onopen?.();
		await list(projects);
	}

	async function list(projects: EverywhereProject[]): Promise<void> {
		await waitUntil(() => listings.length > 0);
		listings.shift()?.(projects);
		await settled();
	}

	const stream = () => streams.at(-1) as Stream;

	it("streams nothing until held, and stops once the last holder lets go", () => {
		expect(streams).toEqual([]);
		held = feed.hold();
		const again = feed.hold();
		expect(streams.map((each) => each.url)).toEqual(["/api/everywhere/events"]);
		held.dispose();
		expect(stream().closed).toBe(false);
		again.dispose();
		expect(stream().closed).toBe(true);
	});

	it("tags every task and conversation with its project, alphabetically", async () => {
		const asked: string[] = [];
		const listing = globalThis.fetch;
		globalThis.fetch = ((url: string) => {
			asked.push(url);
			return listing(url);
		}) as unknown as typeof fetch;
		held = feed.hold();
		await open([
			project("web", {
				tasks: [details({ task: "nav" })],
				conversations: [conversation({ id: "w1" })],
			}),
			project("api", {
				tasks: [details({ task: "auth" })],
				conversations: [conversation({ id: "a1" })],
			}),
		]);

		expect(asked).toEqual(["/api/everywhere"]);
		expect(feed.available).toBe(true);
		expect(feed.projects.map((each) => each.project)).toEqual(["api", "web"]);
		expect(feed.tasks.map(({ project, task }) => [project, task])).toEqual([
			["api", "auth"],
			["web", "nav"],
		]);
		expect(feed.conversations.map(({ project, id }) => [project, id])).toEqual([
			["api", "a1"],
			["web", "w1"],
		]);
		expect(feed.project("web")?.root).toBe("/code/web");
	});

	it("moves a project's conversations and tasks as its stream says", async () => {
		held = feed.hold();
		await open([
			project("api", { conversations: [conversation({ id: "a1" })] }),
		]);

		stream().onmessage?.({
			data: JSON.stringify({
				project: "api",
				conversation: conversation({ id: "a2", name: "New" }),
			}),
		});
		stream().named.get("removed")?.({
			data: JSON.stringify({ project: "api", id: "a1" }),
		});
		stream().named.get("board")?.({
			data: JSON.stringify({
				...project("api"),
				conversations: undefined,
				tasks: [details({ task: "auth" })],
			}),
		});

		expect(feed.conversations.map(({ id }) => id)).toEqual(["a2"]);
		expect(feed.tasks.map(({ task }) => task)).toEqual(["auth"]);
	});

	it("keeps what streamed while a listing was on its way", async () => {
		held = feed.hold();
		await open([project("api")]);
		stream().named.get("projects")?.({ data: "{}" });
		await waitUntil(() => listings.length > 0);
		stream().onmessage?.({
			data: JSON.stringify({
				project: "api",
				conversation: conversation({ id: "a1", name: "Newer" }),
			}),
		});

		await list([
			project("api", {
				conversations: [conversation({ id: "a1", name: "Older" })],
			}),
			project("web"),
		]);

		expect(feed.projects.map((each) => each.project)).toEqual(["api", "web"]);
		expect(feed.conversations.map(({ name }) => name)).toEqual(["Newer"]);
	});

	it("says it is unavailable when the server refuses it", async () => {
		globalThis.fetch = (async () =>
			new Response("no", { status: 403 })) as unknown as typeof fetch;
		held = feed.hold();
		stream().onopen?.();
		await settled();

		expect(feed.loading).toBe(false);
		expect(feed.available).toBe(false);
	});
});

async function settled(): Promise<void> {
	for (let turn = 0; turn < 10; turn++) {
		await Promise.resolve();
	}
}

async function waitUntil(ready: () => boolean): Promise<void> {
	for (let turn = 0; turn < 100 && !ready(); turn++) {
		await Promise.resolve();
	}
}
