// scry-ignore-file simple-test-setup: moved into server/ unchanged; it predates the rule
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { OpenPortProvider } from "webappwiz/system";
import { Duration } from "webappwiz/time";
import type { Snapshot } from "../tasks";
import { add } from "../tasks";
import { Testing } from "../testing";
import { dev } from "./server";
import { readUntil, serving, within } from "./testing";

describe("dev", () => {
	let deps: Testing;

	beforeEach(async () => {
		deps = await Testing.open();
	});

	afterEach(() => deps.disposeAsync());

	describe("watching", () => {
		/** The page's stream of changes, once it has connected. */
		const listen = async (port: number) => {
			const events = await fetch(`http://127.0.0.1:${port}/events`);
			const reader = (events.body ?? new ReadableStream()).getReader();
			await readUntil(reader, ": connected");
			return reader;
		};

		it("hears of an SPLATES.md, a commit and a task as they change, without polling", async () => {
			await add(deps, "alpha");
			const tree = (await deps.service.find("alpha")).path;

			await serving(deps, async (_, port) => {
				const reader = await listen(port);

				await deps.fs.write(
					`${tree}/SPLATES.md`,
					"# alpha\n\n## Goal\n\nmoved\n",
				);
				expect(await within(reader, "data: changed", 5_000)).toBe(true);
				await deps.commit(tree, "a.txt", "a\n", "add a");
				expect(await within(reader, "data: changed", 5_000)).toBe(true);
				await deps.tasks.add("later", null);
				expect(await within(reader, "data: changed", 5_000)).toBe(true);
				await reader.cancel();
			});
		}, 15_000);

		it("hears of an uncommitted edit in a worktree", async () => {
			await add(deps, "alpha");
			const tree = (await deps.service.find("alpha")).path;

			await serving(deps, async (_, port) => {
				const reader = await listen(port);

				await deps.fs.mkdir(`${tree}/docs/deep`, { recursive: true });
				await deps.fs.write(`${tree}/docs/deep/notes.md`, "a\n");
				expect(await within(reader, "data: changed", 5_000)).toBe(true);

				await reader.cancel();
			});
		}, 15_000);

		it("stays quiet while only a conversation's log grows", async () => {
			await serving(deps, async (_, port) => {
				const reader = await listen(port);

				await deps.storage
					.log("conversations/c1.jsonl")
					.append({ kind: "prompt", text: "hi" });
				expect(await within(reader, "data: changed", 500)).toBe(false);
				await reader.cancel();
			});
		});

		it("polls a repo it cannot watch, and says so", async () => {
			const fs = Object.assign(Object.create(deps.fs), {
				watch() {
					throw new Error("no watching here");
				},
			}) as typeof deps.fs;
			const server = await dev(
				{ ...deps, fs },
				{ ports: OpenPortProvider.any() },
			);
			try {
				const reader = await listen(server.port);
				expect(deps.out()).toContain("cannot watch");

				await deps.tasks.add("later", null);
				expect(await within(reader, "data: changed", 10_000)).toBe(true);
				await reader.cancel();
			} finally {
				await server.disposeAsync();
			}
		}, 15_000);
	});

	describe("release", () => {
		it("says on every page when a newer splates is out, and nothing when the check fails", async () => {
			let latest: string | null = null;
			const server = await dev(deps, {
				ports: OpenPortProvider.any(),
				newest: async () => latest,
				running: "0.0.43",
				checkEvery: Duration.ms(20),
			});
			try {
				const { port } = server;
				const read = async () =>
					(
						(await (
							await fetch(`http://127.0.0.1:${port}/api/snapshot`)
						).json()) as Snapshot
					).release;
				expect(await read()).toBeNull();

				const events = await fetch(`http://127.0.0.1:${port}/events`);
				const reader = (events.body as ReadableStream<Uint8Array>).getReader();
				await readUntil(reader, "connected");
				latest = "0.0.44";
				expect(await within(reader, "changed", 5_000)).toBe(true);
				await reader.cancel();
				expect(await read()).toEqual({ running: "0.0.43", newest: "0.0.44" });
			} finally {
				await server.disposeAsync();
			}
		});

		it("says on every page when commits land on the source it runs from, asking npm nothing", async () => {
			let commit = "a".repeat(40);
			let asked = 0;
			const server = await dev(deps, {
				ports: OpenPortProvider.any(),
				newest: async () => {
					asked += 1;
					return "9.9.9";
				},
				source: async () => commit,
				sourceEvery: Duration.ms(20),
			});
			try {
				const { port } = server;
				const read = async () =>
					(await (
						await fetch(`http://127.0.0.1:${port}/api/snapshot`)
					).json()) as Snapshot;
				expect((await read()).behind).toBeNull();

				const events = await fetch(`http://127.0.0.1:${port}/events`);
				const reader = (events.body as ReadableStream<Uint8Array>).getReader();
				await readUntil(reader, "connected");
				commit = "b".repeat(40);
				expect(await within(reader, "changed", 5_000)).toBe(true);
				await reader.cancel();

				expect(await read()).toMatchObject({
					release: null,
					behind: { running: "a".repeat(40), newest: "b".repeat(40) },
				});
				expect(
					await (await fetch(`http://127.0.0.1:${port}/api/projects`)).json(),
				).toMatchObject({
					newest: null,
					behind: { running: "a".repeat(40), newest: "b".repeat(40) },
					restartable: false,
				});
				expect(asked).toBe(0);
			} finally {
				await server.disposeAsync();
			}
		});

		it("says on every page when building it failed as it started", async () => {
			const server = await dev(deps, {
				ports: OpenPortProvider.any(),
				unbuilt: true,
			});
			try {
				const snapshot = (await (
					await fetch(`http://127.0.0.1:${server.port}/api/snapshot`)
				).json()) as Snapshot;
				expect(snapshot.unbuilt).toBe(true);
			} finally {
				await server.disposeAsync();
			}
		});
	});
});
