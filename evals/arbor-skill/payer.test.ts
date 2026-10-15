import { describe, expect, it } from "bun:test";
import { FakePs } from "webappwiz/system/testing";
import { Payer } from "./payer";

describe("Payer", () => {
	it("asks to use a Claude plan's limits when claude is logged in to claude.ai", async () => {
		const ps = new FakePs();
		ps.setCaptureOutput(
			JSON.stringify({ authMethod: "claude.ai", subscriptionType: "max" }),
			"",
		);
		const payer = await Payer.of(ps);
		expect(payer.ask(5.25, 2_140_000)).toBe(
			"Use about $5.25 at API prices (2.1M tokens) of your Claude Max plan's usage limits?",
		);
		expect(payer.used(1.34, 840_000)).toBe(
			"used $1.34 at API prices (840k tokens) of your Claude Max plan's usage limits",
		);
	});

	it("asks to spend on an API key in the environment, which claude takes over a login", async () => {
		const ps = new FakePs();
		ps.setEnv({ ANTHROPIC_API_KEY: "sk-test" });
		ps.setCaptureOutput(JSON.stringify({ authMethod: "claude.ai" }), "");
		expect((await Payer.of(ps)).ask(5.25, 0)).toBe(
			"Spend about $5.25 at API prices on your API key?",
		);
	});

	it("asks to spend, naming no payer, when claude says nothing it knows", async () => {
		const ps = new FakePs();
		ps.setCaptureOutput("not json", "");
		expect((await Payer.of(ps)).ask(5.25, 2_140_000)).toBe(
			"Spend about $5.25 at API prices (2.1M tokens)?",
		);
	});
});
