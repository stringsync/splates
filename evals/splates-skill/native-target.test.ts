import { expect, it } from "bun:test";
import { nativeTarget } from "./native-target";

const opts = {
	source: "/skill",
	mode: "discovery" as const,
	allowance: { tokens: 1000, microUsd: 1000 },
};

it("reads a thinking level after the model", () => {
	const target = nativeTarget("claude:opus@high", opts);

	expect(target.model).toBe("opus");
	expect(target.effort).toBe("high");
});

it("keeps a model with no level as it was", () => {
	const target = nativeTarget("opencode:anthropic/sonnet", opts);

	expect(target.model).toBe("anthropic/sonnet");
	expect(target.effort).toBeNull();
	expect(target.adapter.config).not.toHaveProperty("effort");
});

it("makes the level part of the config, so levels never compare as one", () => {
	const hash = (value: string) =>
		JSON.stringify(nativeTarget(value, opts).adapter.config);

	expect(hash("codex:gpt@low")).not.toBe(hash("codex:gpt@high"));
	expect(hash("codex:gpt@low")).not.toBe(hash("codex:gpt"));
});

it("refuses an @ with no level", () => {
	expect(() => nativeTarget("claude:opus@", opts)).toThrow("thinking level");
});
