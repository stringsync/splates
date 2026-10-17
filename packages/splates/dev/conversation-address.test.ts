import { describe, expect, it } from "bun:test";
import type { Setting } from "../conversations";
import { agentFor, NEW, settingsFor } from "./conversation-address";
import { conversation } from "./testing";

const model = (current: string): Setting[] => [
	{
		id: "model",
		name: "Model",
		category: "model",
		current,
		options: [],
	} as unknown as Setting,
];

const AGENTS = [
	{ id: "claude", name: "Claude", settings: model("saved"), limits: [] },
	{ id: "codex", name: "Codex", settings: model("saved"), limits: [] },
];

describe("a new conversation", () => {
	it("starts as the person last picked, not as a todo assigned since", () => {
		const conversations = [
			conversation({
				id: "c2",
				agent: "codex",
				settings: model("gpt"),
				assigned: true,
			}),
			conversation({
				id: "c1",
				agent: "claude",
				settings: model("sonnet"),
				assigned: true,
			}),
			conversation({ id: "c0", agent: "claude", settings: model("opus") }),
		];

		expect(agentFor(NEW, AGENTS, conversations)).toBe("claude");
		expect(settingsFor("claude", AGENTS, conversations)).toEqual(
			model("saved"),
		);
	});

	it("keeps saved defaults even when the only conversation is assigned", () => {
		const conversations = [
			conversation({
				id: "c1",
				agent: "codex",
				settings: model("gpt"),
				assigned: true,
			}),
		];

		expect(agentFor(NEW, AGENTS, conversations)).toBe("codex");
		expect(settingsFor("codex", AGENTS, conversations)).toEqual(model("saved"));
	});
});
