import { expect, it } from "bun:test";
import { DEFAULT_AGENTS } from "../models";
import type { Classification } from "./classify";
import { decide } from "./decide";
import { DEFAULT_RULES } from "./defaults";
import { routedTo, withCell } from "./testing";

const failing = (model: string) => ({
	agent: "claude",
	model,
	errors: 3,
	last: {
		agent: "claude",
		model,
		at: "2026-07-01T11:50:00.000Z",
		status: 529,
		message: "overloaded",
	},
	incident: null,
	until: "2026-07-01T12:20:00.000Z",
});

it("is passed over for the next pick of its lineup, saying why", () => {
	const picks = DEFAULT_RULES.lineups.find((each) =>
		each.picks.some((pick) => pick.model === "opus"),
	);
	const decision = decide({
		...BASE,
		avoided: [failing("opus")],
		classification: DESIGN,
	});
	expect(decision.pick.model).not.toBe("opus");
	expect(picks).toBeDefined();
	expect(decision.reasons.join("\n")).toContain("passed over Claude");
});

it("is used when nothing else is left, rather than starting nothing", () => {
	const only = routedTo([{ agent: "claude", model: "opus" }]);
	const decision = decide({
		...BASE,
		rules: only,
		avoided: [failing("opus")],
		classification: DESIGN,
	});
	expect(decision.pick.model).toBe("opus");
	expect(decision.reasons.join("\n")).toContain("is failing");
});

const NOW = new Date("2026-07-01T12:00:00.000Z");
const BASE = {
	rules: DEFAULT_RULES,
	agents: DEFAULT_AGENTS,
	runnable: DEFAULT_AGENTS.map((each) => each.id),
	limits: {},
	offered: {},
	now: NOW,
};
const DESIGN: Classification = {
	kinds: { bugfix: 0.72, design: 0.9, open: 0.3, devops: 0.1 },
	depth: { shallow: 0.1, moderate: 0.3, deep: 0.8 },
};

it("falls back on the unsure lineup when every pick of its own is failing", () => {
	const rules = withCell(
		routedTo([{ agent: "codex" }]),
		"design",
		"deep",
		"Mine",
		[{ agent: "claude", model: "opus" }],
	);
	const decision = decide({
		...BASE,
		rules,
		avoided: [failing("opus")],
		classification: DESIGN,
	});
	expect(decision).toMatchObject({ pick: { agent: "codex" }, lineup: "all" });
	expect(decision.reasons).toContain(
		"every pick of Mine is failing, so All, the unsure lineup",
	);
});
