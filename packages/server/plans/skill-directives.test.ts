import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
	APPROVE,
	AUTO,
	CHECKPOINT,
	DEFER,
	HEARTBEAT,
	handoffReference,
	handoffToReference,
	idleReference,
	LANES_DONE,
	laneReference,
	MERGE,
	RECONNECT,
	RESUME,
	reportReference,
	setupReference,
	stoppedReference,
	taskReference,
	todoAddedReference,
	todoDoneReference,
	todoOpenReference,
	todoReference,
} from "./prompts";

describe("the splates skill's Directives table", () => {
	it("has one row for each directive, as the skill writes its placeholders", async () => {
		expect((await rows()).toSorted()).toEqual(
			[
				todoReference(0).replace("0", "N"),
				taskReference("<task>"),
				setupReference("<step>"),
				handoffReference("<task>"),
				handoffToReference({ agent: "<agent>", model: "<model>" }),
				MERGE,
				APPROVE,
				DEFER,
				laneReference(null),
				laneReference(0).replace("0", "N"),
				reportReference("<task>"),
				idleReference("<task>"),
				stoppedReference("<task>"),
				todoDoneReference(0).replace("0", "N"),
				todoOpenReference(0).replace("0", "N"),
				todoAddedReference(0).replace("0", "N"),
				HEARTBEAT,
				LANES_DONE,
				CHECKPOINT,
				RESUME,
				RECONNECT,
				AUTO,
			].toSorted(),
		);
	});
});

/** The directive each row of the skill's Directives table is for. */
async function rows(): Promise<string[]> {
	const skill = await Bun.file(
		join(import.meta.dir, "../../../skills/splates/SKILL.md"),
	).text();
	const section = skill.slice(
		skill.indexOf("## Directives\n"),
		skill.indexOf("## Workflow\n"),
	);
	return [...section.matchAll(/^\| `(\[SPLATES [^\]]+\])` \|/gm)].map(
		(row) => row[1] as string,
	);
}
