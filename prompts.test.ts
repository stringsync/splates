import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
	CHECK_IN,
	CHECKPOINT,
	HEARTBEAT,
	handoffReference,
	handoffToReference,
	idleReference,
	laneReference,
	leadingDirectives,
	MERGE,
	RESUME,
	reportReference,
	stoppedReference,
	taskReference,
	todoReference,
} from "./prompts";

describe("leadingDirectives", () => {
	it("splits the directives a text starts with from the rest", () => {
		expect(
			leadingDirectives("[ARBOR TODO #12]\n\n[ARBOR LANE 2] and keep it small"),
		).toEqual({
			directives: ["[ARBOR TODO #12]", "[ARBOR LANE 2]"],
			rest: "and keep it small",
		});
		expect(leadingDirectives("[ARBOR CHECKPOINT]")).toEqual({
			directives: ["[ARBOR CHECKPOINT]"],
			rest: "",
		});
	});

	it("reads a handoff the page asks for, naming its agent and any model", () => {
		const asked = handoffToReference({ agent: "codex", model: "gpt-5.5" });

		expect(asked).toBe("[ARBOR HANDOFF TO codex gpt-5.5]");
		expect(leadingDirectives(`${asked} for the styles`)).toEqual({
			directives: [asked],
			rest: "for the styles",
		});
		expect(handoffToReference({ agent: "claude" })).toBe(
			"[ARBOR HANDOFF TO claude]",
		);
	});

	it("finds none in a text that starts with anything else, or one half typed", () => {
		const texts = [
			"see [ARBOR TODO #12]",
			"[ARBOR TODO #12",
			"[ARBOR TODO #12]and",
			"[arbor todo #12]",
		];

		expect(texts.map(leadingDirectives)).toEqual(
			texts.map((text) => ({ directives: [], rest: text })),
		);
	});
});

describe("the arbor skill's Directives table", () => {
	it("has one row for each directive, as the skill writes its placeholders", async () => {
		const skill = await Bun.file(
			join(import.meta.dir, "../../skills/arbor/SKILL.md"),
		).text();
		const section = skill.slice(
			skill.indexOf("## Directives\n"),
			skill.indexOf("## Workflow\n"),
		);
		const rows = [...section.matchAll(/^\| `(\[ARBOR [^\]]+\])` \|/gm)].map(
			(row) => row[1],
		);

		expect(rows.toSorted()).toEqual(
			[
				todoReference(0).replace("0", "N"),
				taskReference("<task>"),
				handoffReference("<task>"),
				handoffToReference({ agent: "<agent>", model: "<model>" }),
				MERGE,
				CHECK_IN,
				laneReference(null),
				laneReference(0).replace("0", "N"),
				reportReference("<task>"),
				idleReference("<task>"),
				stoppedReference("<task>"),
				HEARTBEAT,
				CHECKPOINT,
				RESUME,
			].toSorted(),
		);
	});
});
