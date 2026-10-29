import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { OpenPortProvider } from "webappwiz/system";
import { FakeAgent } from "../agents/testing";
import { type ConversationState, Conversations } from "../conversations";
import { type EverywhereListing, GENERAL, GENERAL_NAME } from "../projects";
import { Testing } from "../testing";
import { LocalWorkerMachine } from "../workers";
import type { GeneralOptions } from "./general";
import { dev } from "./index";
import { eventually, json } from "./testing";

const AGENT = { id: "fake", name: "Fake", argv: ["fake-acp"] };
const ID = "0b5c2a8e-9f4d-4c1e-8a3b-2d6f7e9c1a4b";

describe("General conversations", () => {
	let deps: Testing;
	let agent: FakeAgent;

	beforeEach(async () => {
		deps = await Testing.open();
		agent = new FakeAgent();
	});

	afterEach(() => deps.disposeAsync());

	const options = (): GeneralOptions => {
		const root = `${deps.splatesHome}/general`;
		return {
			root,
			scratchRoot: `${root}/workspaces`,
			conversations: new Conversations(`${root}/conversations`, [AGENT], {
				fs: deps.fs,
				storage: deps.machine.within("general/conversations"),
				launch: agent.launch,
				machine: new LocalWorkerMachine(deps.ps, deps.fs),
			}),
		};
	};

	const serving = async (body: (port: number) => Promise<void>) => {
		const server = await dev(deps, {
			ports: OpenPortProvider.any(),
			general: options(),
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

	it("starts in its own scratch, lists first, and survives a restart", async () => {
		await serving(async (port) => {
			const started = await json(
				port,
				`/api/conversations?project=${encodeURIComponent(GENERAL)}`,
				"POST",
				{ id: ID, agent: "fake" },
			);
			const state = (await started.json()) as ConversationState;
			expect(state).toMatchObject({ id: ID, scratch: true, task: null });
			// The agent launches after the start answers.
			await eventually(async () => agent.launched.length > 0, 5_000);
			expect(agent.launched[0]).toMatchObject({
				cwd: `${deps.splatesHome}/general/workspaces/${ID}`,
				env: { SPLATES_SCRATCH: "fake" },
			});

			const snapshot = await (
				await fetch(
					`http://127.0.0.1:${port}/api/snapshot?project=${encodeURIComponent(GENERAL)}`,
				)
			).json();
			expect(snapshot).toMatchObject({ project: GENERAL, repo: GENERAL_NAME });
			const listing = (await (
				await fetch(`http://127.0.0.1:${port}/api/everywhere`)
			).json()) as EverywhereListing;
			expect(listing.projects[0]).toMatchObject({
				project: GENERAL,
				conversations: [{ id: ID, scratch: true }],
			});
		});

		await serving(async (port) => {
			const read = await fetch(
				`http://127.0.0.1:${port}/api/conversations/${ID}`,
			);
			expect(await read.json()).toMatchObject({ id: ID, scratch: true });
			const form = new FormData();
			form.set("text", "again");
			const prompted = await fetch(
				`http://127.0.0.1:${port}/api/conversations/${ID}/prompt`,
				{
					method: "POST",
					headers: { origin: `http://127.0.0.1:${port}` },
					body: form,
				},
			);
			expect(await prompted.json()).toMatchObject({ id: ID, scratch: true });
			expect(agent.launched.at(-1)?.env.SPLATES_SCRATCH).toBe("fake");
		});
	});

	it("continues in a project's main tree, told where General's transcript is", async () => {
		await serving(async (port) => {
			await json(
				port,
				`/api/conversations?project=${encodeURIComponent(GENERAL)}`,
				"POST",
				{ id: ID, agent: "fake" },
			);
			const continued = (await (
				await json(port, `/api/conversations/${ID}/continue`, "POST", {
					project: "repo",
				})
			).json()) as { project: string; id: string };
			expect(continued.project).toBe("repo");
			expect(continued.id).not.toBe(ID);

			const there = (await (
				await fetch(
					`http://127.0.0.1:${port}/api/conversations/${continued.id}?project=repo`,
				)
			).json()) as ConversationState;
			expect(there.scratch).toBeUndefined();
			expect(there.task).toBeNull();
			expect(agent.launched.at(-1)).toMatchObject({ cwd: deps.root });
			expect(agent.launched.at(-1)?.env.SPLATES_SCRATCH).toBeUndefined();
			expect(
				await eventually(async () => agent.prompts.length > 0, 5_000),
			).toBe(true);
			const told = JSON.stringify(agent.prompts.at(-1));
			expect(told).toContain(`${ID}/transcript.md`);
			expect(told).toContain("starting a task before changing code");

			const refused = await json(
				port,
				`/api/conversations/${ID}/continue`,
				"POST",
				{
					project: GENERAL,
				},
			);
			expect(refused.status).toBe(400);
		});
	});
});
