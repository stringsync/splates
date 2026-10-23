import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
	APPROVE,
	CHECKPOINT,
	groomReference,
	MERGE,
	RECONNECT,
	RESUME,
	RUN_ALLOWED,
	RUN_DENIED,
	taskNumberReference,
	taskReference,
} from "./prompts";

describe("the splates skill's Directives table", () => {
	it("has one row for each directive in regular use, as the skill writes its placeholders", async () => {
		expect((await rows()).toSorted()).toEqual(
			[
				taskNumberReference(0).replace("0", "N"),
				taskReference("<task>"),
				MERGE,
				APPROVE,
				CHECKPOINT,
				RESUME,
				RECONNECT,
				RUN_ALLOWED,
				RUN_DENIED,
				groomReference(0).replace("0", "N"),
				"[SPLATES LANE N]",
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
	return [...section.matchAll(/^\| `(\[SPLATES [^\]]+\])` *\|/gm)].map(
		(row) => row[1] as string,
	);
}
