import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { OpenPortProvider } from "webappwiz/system";
import { Duration } from "webappwiz/time";
import { add } from "./add";
import { dev } from "./dev";
import { readUntil, serving, within } from "./dev-testing";
import type { Snapshot } from "./snapshot";
import { Testing } from "./testing";

describe("dev", () => {
	let deps: Testing;

	beforeEach(async () => {
		deps = await Testing.open();
	});

	afterEach(() => deps.disposeAsync());

	describe("watching", () => {
		/** The page's stream of changes, once it has connected. */
		const listen = async (port: number) => {
			const events = await fetch(`http://localhost:${port}/events`);
			const reader = (events.body ?? new ReadableStream()).getReader();
			await readUntil(reader, ": connected");
			return reader;
		};

		it("hears of an ARBOR.md, a commit and a todo as they change, without polling", async () => {
			await add(deps, "alpha");
			const tree = (await deps.service.find("alpha")).path;

			await serving(deps, async (_, port) => {
				const reader = await listen(port);

				await deps.fs.write(
					`${tree}/ARBOR.md`,
					"# alpha\n\n## Goal\n\nmoved\n",
				);
				expect(await within(reader, "data: changed", 5_000)).toBe(true);
				await deps.commit(tree, "a.txt", "a\n", "add a");
				expect(await within(reader, "data: changed", 5_000)).toBe(true);
				await deps.todos.add("later", null);
				expect(await within(reader, "data: changed", 5_000)).toBe(true);
				await reader.cancel();
			});
		}, 15_000);

		it("hears of an uncommitted edit in a worktree, and the systems it falls in", async () => {
			await add(deps, "alpha");
			const tree = (await deps.service.find("alpha")).path;

			await serving(deps, async (_, port) => {
				const reader = await listen(port);

				await deps.fs.write(
					`${tree}/arbor.config.ts`,
					`export default { systems: { docs: { globs: ["docs/**"] } } };\n`,
				);
				await deps.fs.mkdir(`${tree}/docs/deep`, { recursive: true });
				await deps.fs.write(`${tree}/docs/deep/notes.md`, "a\n");
				expect(await within(reader, "data: changed", 5_000)).toBe(true);
				const snapshot = await (
					await fetch(`http://localhost:${port}/api/snapshot`)
				).json();
				expect(snapshot.tasks[0].systems).toEqual([
					{ name: "docs", globs: ["docs/**"] },
				]);
				await reader.cancel();
			});
		}, 15_000);

		it("stays quiet while only a conversation's log grows", async () => {
			await deps.fs.mkdir(`${deps.arborDir}/conversations`);
			await serving(deps, async (_, port) => {
				const reader = await listen(port);

				await deps.fs.write(
					`${deps.arborDir}/conversations/c1.jsonl`,
					'{"kind":"prompt","text":"hi"}\n',
				);
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

				await deps.todos.add("later", null);
				expect(await within(reader, "data: changed", 10_000)).toBe(true);
				await reader.cancel();
			} finally {
				await server.disposeAsync();
			}
		}, 15_000);
	});

	describe("release", () => {
		it("says on every page when a newer arbor is out, and nothing when the check fails", async () => {
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
							await fetch(`http://localhost:${port}/api/snapshot`)
						).json()) as Snapshot
					).release;
				expect(await read()).toBeNull();

				const events = await fetch(`http://localhost:${port}/events`);
				const reader = events.body?.getReader();
				if (!reader) {
					throw new Error("no event stream");
				}
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
						await fetch(`http://localhost:${port}/api/snapshot`)
					).json()) as Snapshot;
				expect((await read()).behind).toBeNull();

				const events = await fetch(`http://localhost:${port}/events`);
				const reader = events.body?.getReader();
				if (!reader) {
					throw new Error("no event stream");
				}
				await readUntil(reader, "connected");
				commit = "b".repeat(40);
				expect(await within(reader, "changed", 5_000)).toBe(true);
				await reader.cancel();

				expect(await read()).toMatchObject({
					release: null,
					behind: { running: "a".repeat(40), newest: "b".repeat(40) },
				});
				expect(
					await (await fetch(`http://localhost:${port}/api/projects`)).json(),
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
	});
});
