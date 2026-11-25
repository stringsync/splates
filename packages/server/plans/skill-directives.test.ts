import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
	APPROVE,
	BLOCKERS_CLEARED,
	CHECKPOINT,
	MERGE,
	RECONNECT,
	RESUME,
	RETRIED,
	RUN_ALLOWED,
	RUN_DENIED,
	talkReference,
	taskNumberReference,
	taskReference,
} from "./prompts";

describe("the splates skill's Directives table", () => {
	it("has one row for each directive in regular use, as the skill writes its placeholders", async () => {
		expect((await rows()).toSorted()).toEqual(
			[
				taskNumberReference(0).replace("0", "N"),
				taskReference("<task>"),
				talkReference(0).replace("0", "N"),
				MERGE,
				APPROVE,
				CHECKPOINT,
				RESUME,
				RECONNECT,
				BLOCKERS_CLEARED,
				RUN_ALLOWED,
				RUN_DENIED,
				RETRIED,
				"[SPLATES SIGNAL <name>]",
				"[SPLATES EVAL LOOP <run>]",
			].toSorted(),
		);
	});
});

/** The directive each row of the skill's Directives table is for. */
async function rows(): Promise<string[]> {
	const skill = await Bun.file(
		join(import.meta.dir, "../../../skills/splates/SKILL.md"),
	).text();
	const start = skill.indexOf("## Directives\n");
	const nextHeading = skill.indexOf("\n## ", start + 1);
	const section =
		nextHeading === -1 ? skill.slice(start) : skill.slice(start, nextHeading);
	return [...section.matchAll(/^\| `(\[SPLATES [^\]]+\])` *\|/gm)].map(
		(row) => row[1] as string,
	);
}
