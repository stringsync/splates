import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { OpenPortProvider } from "webappwiz/system";
import { FakeAgent, ROSTERED } from "../agents/testing";
import { Conversations } from "../conversations";
import { Testing } from "../testing";
import { dev } from "./server";
import { json } from "./testing";

describe("Auto pick's switch for a conversation", () => {
	let deps: Testing;
	let conversations: Conversations;
	let server: Awaited<ReturnType<typeof dev>>;

	beforeEach(async () => {
		deps = await Testing.open();
		conversations = new Conversations(
			`${deps.splatesDir}/conversations`,
			[ROSTERED],
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

	it("starts a conversation on the picked agent with Auto pick to judge its first message", async () => {
		const started = await json(server.port, "/api/conversations", "POST", {
			agent: "fake",
			autoPick: true,
		});

		expect(await started.json()).toMatchObject({
			agent: "fake",
			autoPick: { agent: "fake", overridden: false, rejudge: true },
		});
	});

	it("switches Auto pick on and off for a conversation", async () => {
		const started = await json(server.port, "/api/conversations", "POST", {
			agent: "fake",
		});
		const { id, autoPick } = (await started.json()) as {
			id: string;
			autoPick: unknown;
		};
		expect(autoPick).toBeNull();

		const on = await json(
			server.port,
			`/api/conversations/${id}/auto-pick`,
			"PUT",
			{ on: true },
		);
		expect(await on.json()).toMatchObject({ autoPick: { rejudge: true } });
		const off = await json(
			server.port,
			`/api/conversations/${id}/auto-pick`,
			"PUT",
			{ on: false },
		);
		expect(await off.json()).toMatchObject({ autoPick: { overridden: true } });
	});
});
