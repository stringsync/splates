import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
	APPROVE,
	CAPTURE,
	CHECK_IN,
	CHECKPOINT,
	HEARTBEAT,
	handoffReference,
	handoffToReference,
	idleReference,
	investigateReference,
	laneReference,
	MERGE,
	RECONNECT,
	RESUME,
	reportReference,
	setupReference,
	stoppedReference,
	taskReference,
	todoReference,
} from "./prompts";

describe("the arbor skill's Directives table", () => {
	it("has one row for each directive, as the skill writes its placeholders", async () => {
		expect((await rows()).toSorted()).toEqual(
			[
				todoReference(0).replace("0", "N"),
				taskReference("<task>"),
				setupReference("<step>"),
				handoffReference("<task>"),
				handoffToReference({ agent: "<agent>", model: "<model>" }),
				MERGE,
				investigateReference("<task>"),
				APPROVE,
				CAPTURE,
				CHECK_IN,
				laneReference(null),
				laneReference(0).replace("0", "N"),
				reportReference("<task>"),
				idleReference("<task>"),
				stoppedReference("<task>"),
				HEARTBEAT,
				CHECKPOINT,
				RESUME,
				RECONNECT,
			].toSorted(),
		);
	});
});

/** The directive each row of the skill's Directives table is for. */
async function rows(): Promise<string[]> {
	const skill = await Bun.file(
		join(import.meta.dir, "../../skills/arbor/SKILL.md"),
	).text();
	const section = skill.slice(
		skill.indexOf("## Directives\n"),
		skill.indexOf("## Workflow\n"),
	);
	return [...section.matchAll(/^\| `(\[ARBOR [^\]]+\])` \|/gm)].map(
		(row) => row[1] as string,
	);
}
