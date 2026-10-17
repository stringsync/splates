import { describe, expect, it } from "bun:test";
import { OpenPortProvider } from "webappwiz/system";
import { Conversations } from "./conversations";
import { dev } from "./dev";
import { json } from "./dev-testing";
import { FakeAgent } from "./fake-agent";
import { DEFAULT_AGENTS } from "./roster";
import { OpenCodeFixturePs } from "./setup-opencode-fixture";
import { Testing } from "./testing";

describe("OpenCode setup on the running server", () => {
	it("refreshes the live roster, opens the explicit main model in the checked project, and disables safely", async () => {
		await using deps = await Testing.open();
		const ps = new OpenCodeFixturePs();
		ps.setEnv({ ARBOR_HOME: deps.arborHome });
		const agent = new FakeAgent();
		agent.options = [
			{
				type: "select",
				id: "model",
				name: "Model",
				category: "model",
				currentValue: "opencode-go/Small",
				options: [
					{ value: "opencode-go/Main", name: "Main" },
					{ value: "opencode-go/Small", name: "Small" },
				],
			},
		];
		const conversations = new Conversations(
			`${deps.arborDir}/conversations`,
			structuredClone(DEFAULT_AGENTS),
			{ fs: deps.fs, launch: agent.launch },
		);
		const server = await dev(
			{
				fs: deps.fs,
				ps,
				log: deps.log,
				assets: deps.assets,
				projects: deps.projects,
				opened: deps.opened,
				secrets: deps.secrets,
			},
			{ ports: OpenPortProvider.any(), conversations: () => conversations },
		);
		try {
			const post = (path: string, body = {}) =>
				json(server.port, `/api/setup/opencode/${path}`, "POST", body);
			expect((await post("conversation")).status).toBe(400);
			expect((await post("check")).status).toBe(200);
			expect((await post("models/refresh")).status).toBe(200);
			const preview = await (
				await post("models/preview", {
					model: "opencode-go/Main",
					auxiliary: "opencode-go/Small",
				})
			).json();
			expect(
				(
					await post("models/apply", {
						token: preview.preview.token,
						balanceOff: true,
					})
				).status,
			).toBe(200);
			expect(conversations.agents.map((agent) => agent.id)).toEqual([
				"claude",
				"codex",
				"opencode",
			]);
			const listing = await (
				await fetch(`http://localhost:${server.port}/api/conversations`)
			).json();
			expect(
				listing.agents.at(-1).models.map((model: { id: string }) => model.id),
			).toEqual(["opencode-go/Main", "opencode-go/Small"]);
			const checked = await (await post("readiness")).json();
			expect(checked).toMatchObject({ ready: true, cwd: deps.root });
			ps.conflict = true;
			expect((await post("conversation", { balanceOff: true })).status).toBe(
				400,
			);
			expect(agent.launched).toEqual([]);
			ps.conflict = false;
			const response = await post("conversation", { balanceOff: true });
			expect(response.status).toBe(200);
			const existing = (await conversations.list())[0];
			await existing?.opening;
			expect(agent.launched[0]?.cwd).toBe(deps.root);
			expect(agent.chosen).toContainEqual({
				configId: "model",
				value: "opencode-go/Main",
			});
			expect(agent.prompts).toEqual([]);
			const snapshot = existing?.agent;
			expect((await post("disable")).status).toBe(200);
			expect(conversations.agents.map((agent) => agent.id)).toEqual([
				"claude",
				"codex",
			]);
			expect(existing?.agent).toBe(snapshot);
			expect(existing?.agent?.id).toBe("opencode");
			expect(new Set(ps.requests)).toEqual(new Set(["initialize"]));
			const refused = await fetch(
				`http://localhost:${server.port}/api/setup/opencode/readiness`,
				{ method: "POST", headers: { origin: "https://foreign.invalid" } },
			);
			expect(refused.status).toBe(403);
		} finally {
			await server.disposeAsync();
		}
	});
});
