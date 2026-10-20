import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
	APPROVE,
	CHECKPOINT,
	DEFER,
	demoReference,
	eventReference,
	groomReference,
	KEEP,
	MERGE,
	RECONNECT,
	RESUME,
	scheduleReference,
	setupReference,
	taskNumberReference,
	taskReference,
} from "./prompts";

describe("the splates skill's Directives table", () => {
	it("has one row for each directive, as the skill writes its placeholders", async () => {
		expect((await rows()).toSorted()).toEqual(
			[
				taskNumberReference(0).replace("0", "N"),
				taskReference("<task>"),
				setupReference("<step>"),
				MERGE,
				APPROVE,
				DEFER,
				KEEP,
				demoReference("<task>", "before").replace("before", "<point>"),
				CHECKPOINT,
				RESUME,
				RECONNECT,
				eventReference("<event>", [0], "<task>").replace("0", "N"),
				scheduleReference("<n>"),
				groomReference(0).replace("0", "N"),
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
