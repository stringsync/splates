import { describe, expect, it } from "bun:test";
import { DEFAULT_AGENTS } from "../models";
import { decideWithout } from "./decide";
import { DEFAULT_RULES } from "./defaults";
import { routedTo, withCell } from "./testing";

describe("decideWithout", () => {
	it("takes the defaults' lineup for an unsure kind at an unsure depth", () => {
		expect(
			decideWithout({
				reason: "the judge took over 5s",
				rules: DEFAULT_RULES,
				agents: DEFAULT_AGENTS,
				runnable: DEFAULT_AGENTS.map((each) => each.id),
				limits: {},
				offered: {},
				now: new Date("2026-10-19T12:00:00Z"),
			}),
		).toEqual({
			pick: { agent: "claude", model: "sonnet", effort: "medium" },
			lineup: "standard",
			kind: null,
			depth: null,
			reasons: [
				"Sonnet 5.5, medium effort",
				"the judge took over 5s",
				"route: Unsure · Unsure → Standard",
			],
		});
	});

	it("takes no cell that names a kind or a depth", () => {
		const rules = withCell(
			withCell(routedTo([{ agent: "codex" }]), "open", "unsure", "Open", [
				{ agent: "claude", model: "haiku" },
			]),
			"unsure",
			"shallow",
			"Shallow",
			[{ agent: "claude", model: "haiku" }],
		);
		expect(
			decideWithout({
				reason: "no judge",
				rules,
				agents: DEFAULT_AGENTS,
				runnable: DEFAULT_AGENTS.map((each) => each.id),
				limits: {},
				offered: {},
				now: new Date("2026-10-19T12:00:00Z"),
			}),
		).toMatchObject({ pick: { agent: "codex" }, lineup: "all" });
	});
});
