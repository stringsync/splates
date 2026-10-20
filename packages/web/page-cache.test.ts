import { beforeEach, describe, expect, it } from "bun:test";
import {
	type Answer,
	PageCache,
	type PageCaches,
	type Stale,
} from "./page-cache";

const ORIGIN = "https://splates.example.com";

describe("PageCache", () => {
	let kept: Map<string, string>;
	let served: Map<string, Response | "down">;
	let asked: string[];
	let told: { client: string; message: Stale }[];
	let cache: PageCache;

	beforeEach(() => {
		kept = new Map();
		served = new Map();
		asked = [];
		told = [];
		const caches: PageCaches = {
			open: async () => ({
				match: async (key) =>
					kept.has(key) ? new Response(kept.get(key)) : undefined,
				put: async (key, response) => {
					kept.set(key, await response.text());
				},
				delete: async (key) =>
					kept.delete(
						new URL(key, ORIGIN).pathname + new URL(key, ORIGIN).search,
					),
				keys: async () =>
					[...kept.keys()].map((key) => ({ url: `${ORIGIN}${key}` })),
			}),
		};
		cache = new PageCache(
			caches,
			{
				get: async (client) => ({
					postMessage: (message) => told.push({ client, message }),
				}),
			},
			async (request) => {
				const url = new URL(
					typeof request === "string" ? request : request.url,
					ORIGIN,
				);
				const path = `${url.pathname}${url.search}`;
				asked.push(path);
				const answer = served.get(path);
				if (answer === "down") {
					throw new TypeError("no server");
				}
				return answer?.clone() ?? new Response(null, { status: 404 });
			},
		);
	});

	const navigate = (path: string) =>
		cache.respond(new Request(`${ORIGIN}${path}`, { mode: "navigate" }), "w1");

	async function text(answer: Answer | null): Promise<string> {
		const response = await answer?.response;
		await answer?.after;
		return (await response?.text()) ?? "";
	}

	it("serves the shell from the network the first time, keeping it for the next", async () => {
		served.set("/?project=shop", new Response("shell 1"));

		expect(await text(navigate("/?project=shop"))).toBe("shell 1");
		await Bun.sleep(0);

		expect(kept.get("/")).toBe("shell 1");
	});

	it("serves a kept shell at once, saying nothing while the server's is the same", async () => {
		kept.set("/", "shell 1");
		served.set("/", new Response("shell 1"));

		expect(await text(navigate("/"))).toBe("shell 1");

		expect(told).toEqual([]);
	});

	it("keeps a changed shell, drops the files the old one named and tells its window to reload", async () => {
		kept.set("/", "shell 1");
		kept.set("/main.js?v=old", "old script");
		served.set("/", new Response("shell 2"));

		expect(await text(navigate("/"))).toBe("shell 1");

		expect([...kept]).toEqual([["/", "shell 2"]]);
		expect(told).toEqual([
			{ client: "w1", message: { type: "splates:reload" } },
		]);
	});

	it("drops a shell the server refuses, as Access does once sign-in runs out, and reloads", async () => {
		kept.set("/", "shell 1");
		served.set("/", new Response(null, { status: 403 }));

		await text(navigate("/"));

		expect(kept.has("/")).toBe(false);
		expect(told).toHaveLength(1);
	});

	it("keeps serving a kept shell while the server is down", async () => {
		kept.set("/", "shell 1");
		served.set("/", "down");

		expect(await text(navigate("/"))).toBe("shell 1");

		expect(kept.get("/")).toBe("shell 1");
		expect(told).toEqual([]);
	});

	it("keeps the files named by what they hold, and serves them without the network", async () => {
		served.set("/main.js?v=abc", new Response("script"));
		served.set("/chunk-x1y2.js", new Response("chunk"));
		const get = (path: string) =>
			cache.respond(new Request(`${ORIGIN}${path}`), "");

		await text(get("/main.js?v=abc"));
		await text(get("/chunk-x1y2.js"));
		await Bun.sleep(0);
		asked = [];

		expect(await text(get("/main.js?v=abc"))).toBe("script");
		expect(await text(get("/chunk-x1y2.js"))).toBe("chunk");
		expect(asked).toEqual([]);
	});

	it("leaves the server's reads, unstamped files and writes to the network", () => {
		const get = (path: string, init?: RequestInit) =>
			cache.respond(new Request(`${ORIGIN}${path}`, init), "");

		expect(get("/api/snapshot")).toBeNull();
		expect(get("/main.js")).toBeNull();
		expect(get("/worker.js")).toBeNull();
		expect(get("/api/todos", { method: "POST" })).toBeNull();
	});
});
