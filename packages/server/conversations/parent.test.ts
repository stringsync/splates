import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { OpenPortProvider } from "webappwiz/system";
import { AGENT, FakeAgent } from "../agents/testing";
import { dev } from "../server";
import { json } from "../server/testing";
import { Testing } from "../testing";
import { Conversations } from "./conversations";

describe("dev conversations' parent", () => {
	let deps: Testing;
	let conversations: Conversations;
	let server: Awaited<ReturnType<typeof dev>>;

	beforeEach(async () => {
		deps = await Testing.open();
		conversations = new Conversations(
			`${deps.splatesDir}/conversations`,
			[AGENT],
			{ launch: new FakeAgent().launch },
		);
		server = await dev(deps, {
			ports: OpenPortProvider.any(),
			conversations: () => conversations,
		});
	});

	afterEach(async () => {
		await server.disposeAsync();
		await deps.disposeAsync();
	});

	it("nests one where the person put it, but never under itself", async () => {
		const started = await json(server.port, "/api/conversations", "POST", {
			agent: "fake",
		});
		const { id } = (await started.json()) as { id: string };
		const path = `/api/conversations/${id}/parent`;

		const top = await json(server.port, path, "PUT", { parent: null });
		const under = await json(server.port, path, "PUT", { parent: id });

		expect(await top.json()).toMatchObject({ id, parent: { id: null } });
		expect(under.status).toBe(400);
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

		const moved = await json(
			server.port,
			`/api/conversations/${subagent.id}/parent`,
			"PUT",
			{ parent: null },
		);

		expect(await moved.json()).toMatchObject({ reason: "blocked" });
		expect(subagent.state.parent).toBeNull();
	});
});
