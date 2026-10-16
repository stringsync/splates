import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { OpenPortProvider } from "webappwiz/system";
import { Conversations } from "./conversations";
import { dev } from "./dev";
import { json } from "./dev-testing";
import { AGENT, FakeAgent } from "./fake-agent";
import { Testing } from "./testing";

describe("dev conversations' parent", () => {
	let deps: Testing;
	let conversations: Conversations;

	beforeEach(async () => {
		deps = await Testing.open();
		conversations = new Conversations(
			`${deps.arborDir}/conversations`,
			[AGENT],
			{ launch: new FakeAgent().launch },
		);
	});

	afterEach(() => deps.disposeAsync());

	it("nests one where the person put it, but never under itself", async () => {
		const server = await dev(deps, {
			ports: OpenPortProvider.any(),
			conversations: () => conversations,
		});
		try {
			const { port } = server;
			const started = await json(port, "/api/conversations", "POST", {
				agent: "fake",
			});
			const { id } = (await started.json()) as { id: string };
			const path = `/api/conversations/${id}/parent`;

			const top = await json(port, path, "PUT", { parent: null });
			const under = await json(port, path, "PUT", { parent: id });

			expect(await top.json()).toMatchObject({ id, parent: { id: null } });
			expect(under.status).toBe(400);
		} finally {
			await server.disposeAsync();
		}
	});

	it("keeps a subagent under the one it answers to", async () => {
		const host = await conversations.start("fake", {
			task: null,
			cwd: deps.root,
		});
		const subagent = await conversations.start("fake", {
			task: null,
			cwd: deps.root,
			handedBy: host.id,
		});
		const server = await dev(deps, {
			ports: OpenPortProvider.any(),
			conversations: () => conversations,
		});
		try {
			const moved = await json(
				server.port,
				`/api/conversations/${subagent.id}/parent`,
				"PUT",
				{ parent: null },
			);

			expect(await moved.json()).toMatchObject({ reason: "blocked" });
			expect(subagent.state.parent).toBeNull();
		} finally {
			await server.disposeAsync();
		}
	});
});
