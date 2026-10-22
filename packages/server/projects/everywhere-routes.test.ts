import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { OpenPortProvider } from "webappwiz/system";
import { AGENT, FakeAgent } from "../agents/testing";
import { Conversations } from "../conversations";
import { dev } from "../server";
import { eventually, json, readUntil } from "../server/testing";
import { add } from "../tasks";
import { Testing } from "../testing";
import type { EverywhereListing } from "./everywhere-routes";

describe("dev everywhere", () => {
	let deps: Testing;
	let agent: FakeAgent;

	beforeEach(async () => {
		deps = await Testing.open();
		agent = new FakeAgent();
	});

	afterEach(() => deps.disposeAsync());

	/** A second repository, registered after the one the server runs in. */
	const another = async () => {
		const other = await Testing.open({ alongside: deps });
		// Opening it registered it; this one is registered first.
		await deps.projects.forget(other.root);
		await deps.projects.register(deps.root);
		await deps.projects.register(other.root);
		return other;
	};

	/** Serves with conversations, for as long as `body` runs. */
	const serving = async (body: (port: number) => Promise<void>) => {
		const server = await dev(deps, {
			ports: OpenPortProvider.any(),
			conversations: ({ dir, storage }) =>
				new Conversations(`${dir}/conversations`, [AGENT], {
					storage: storage.within("conversations"),
					launch: agent.launch,
				}),
		});
		try {
			await body(server.port);
		} finally {
			await server.disposeAsync();
		}
	};

	const listing = async (port: number) =>
		(await (
			await fetch(`http://127.0.0.1:${port}/api/everywhere`)
		).json()) as EverywhereListing;

	it("lists every registered project's tasks and conversations by its slug", async () => {
		await using other = await another();
		await add(other, "beta");
		await serving(async (port) => {
			const started = await json(
				port,
				"/api/conversations?project=repo-2",
				"POST",
				{ agent: "fake" },
			);
			const { id } = (await started.json()) as { id: string };

			// Opening repo-2 for the first time waits on nothing the focused one shows.
			expect(
				await eventually(
					async () => (await listing(port)).projects.length === 2,
					5_000,
				),
			).toBe(true);
			const { projects } = await listing(port);
			expect(projects.map((each) => each.project)).toEqual(["repo", "repo-2"]);
			expect(projects[1]?.root).toBe(other.root);
			expect(projects[1]?.tasks.map((task) => task.task)).toEqual(["beta"]);
			expect(projects[1]?.conversations.map((each) => each.id)).toEqual([id]);
			expect(projects[0]?.tasks).toEqual([]);
			expect(projects[0]?.conversations).toEqual([]);
		});
	}, 15_000);

	it("opens a project no page asked for once the feed is read", async () => {
		await using other = await another();
		await add(other, "beta");
		await serving(async (port) => {
			expect(
				await eventually(
					async () =>
						(await listing(port)).projects.some(
							(each) => each.project === "repo-2" && each.tasks.length === 1,
						),
					5_000,
				),
			).toBe(true);
		});
	}, 15_000);

	it("streams each project's conversations and tasks, tagged by slug", async () => {
		await using other = await another();
		await serving(async (port) => {
			await json(port, "/api/conversations?project=repo-2", "POST", {
				agent: "fake",
			});
			await eventually(
				async () => (await listing(port)).projects.length === 2,
				5_000,
			);
			const response = await fetch(
				`http://127.0.0.1:${port}/api/everywhere/events`,
			);
			const reader = (response.body as ReadableStream<Uint8Array>).getReader();
			await readUntil(reader, "connected");

			await json(port, "/api/conversations?project=repo-2", "POST", {
				agent: "fake",
			});
			expect(await readUntil(reader, '"project":"repo-2"')).toContain(
				'"conversation":{',
			);

			await add(other, "gamma");
			const board = await readUntil(reader, '"task":"gamma"');
			expect(board).toContain("event: board");
			expect(board.slice(board.lastIndexOf("event: board"))).toContain(
				'"project":"repo-2"',
			);
			await reader.cancel();
		});
	}, 15_000);

	it("streams metadata deltas after a full copy and resets on reconnect", async () => {
		await serving(async (port) => {
			const started = await json(port, "/api/conversations", "POST", {
				agent: "fake",
			});
			const { id } = (await started.json()) as { id: string };
			const response = await fetch(
				`http://127.0.0.1:${port}/api/everywhere/events`,
			);
			const reader = (response.body as ReadableStream<Uint8Array>).getReader();
			const initial = await readUntil(reader, '"conversation":');
			expect(initial).toContain('"messages":[]');
			await json(port, `/api/conversations/${id}/name`, "PUT", {
				name: "delta-name",
			});
			const delta = await readUntil(reader, '"name":"delta-name"');
			expect(delta).toContain("event: delta");
			expect(delta).toContain('"project":"repo"');
			expect(delta).not.toContain('"agent":');
			await reader.cancel();
			const reconnected = await fetch(
				`http://127.0.0.1:${port}/api/everywhere/events`,
			);
			const again = (
				reconnected.body as ReadableStream<Uint8Array>
			).getReader();
			expect(await readUntil(again, '"name":"delta-name"')).toContain(
				'"conversation":',
			);
			await again.cancel();
		});
	});

	it("finds a conversation of a project not served yet by its id", async () => {
		await using _other = await another();
		let id = "";
		await serving(async (port) => {
			const started = await json(
				port,
				"/api/conversations?project=repo-2",
				"POST",
				{ agent: "fake" },
			);
			({ id } = (await started.json()) as { id: string });
		});

		// A run that has yet to open repo-2, as after a restart.
		await serving(async (port) => {
			const renamed = await json(port, `/api/conversations/${id}/name`, "PUT", {
				name: "Elsewhere",
			});
			expect(await renamed.json()).toMatchObject({ id, name: "Elsewhere" });
		});
	}, 15_000);
});
