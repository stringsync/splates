import {
	lastSaid,
	section,
	splatesRuns,
	touchesCode,
	turnsOf,
} from "./reading";
import type { Scenario } from "./scenario";

// The scenarios that resume a task already planned, retry-413, and send it a
// directive from the `splates server` page as their second turn.

/** The prompt that claims the planned task, stopping before any code changes. */
const PICK_UP =
	"[SPLATES TASK retry-413]\n\nPick it up and stop before the first code change; say in one line where it stands.";

/** Takes queued task #1 as `retry-413`, with SPLATES.md planned and nothing coded yet. */
const PLANNED = `splates add retry-413 --task 1 && cat > "$(splates path retry-413)/SPLATES.md" <<'EOF'
# retry-413

## Goal

Stop retrying an upload the server refused as too big (413), and tell the user why.

## Next

- [x] read src/upload.ts
- [ ] stop retrying on 413
- [ ] tell the user the file is too big
- [ ] test both

EOF`;

/** A checkpoint stops the work, leaving SPLATES.md saying where it stood. */
export const CHECKPOINT: Scenario = {
	id: "checkpoint",
	turns: [PICK_UP, "[SPLATES CHECKPOINT]"],
	setup: PLANNED,
	sections: [
		"Using splates",
		"Directives",
		"Reference files",
		"Workflow",
		"Checkpoint",
		"SPLATES.md",
	],
	checks: [
		{
			id: "claimed",
			rule: "Claims the task and reads its SPLATES.md",
			judge: ({ log }) => {
				const [first = []] = turnsOf(log.transcript.beats);
				const claimed = splatesRuns(first).some(
					(run) => run.verb === "claim" && run.args[0] === "retry-413",
				);
				const read =
					log.tools.some(
						(tool) =>
							tool.turn === 1 &&
							JSON.stringify(tool.input).includes("SPLATES.md"),
					) || splatesRuns(first).some((run) => run.verb === "show");
				return [
					{
						ok: claimed && read,
						why: `${claimed ? "claimed" : "never claimed"}; ${read ? "read SPLATES.md" : "never read SPLATES.md"}`,
					},
				];
			},
		},
		{
			id: "stopped",
			rule: "Starts no new work on a checkpoint",
			judge: ({ log }) => {
				const second = turnsOf(log.transcript.beats)[1] ?? [];
				const edited = second.some(touchesCode);
				const merged = splatesRuns(second).some((run) => run.verb === "merge");
				return [
					{
						ok: !edited && !merged,
						why: edited ? "edited code" : merged ? "merged" : "stopped",
					},
				];
			},
		},
		{
			id: "noted",
			rule: "Records where it stopped under the current Next step",
			judge: ({ end }) => {
				const plan =
					end.tasks.find((task) => task.task === "retry-413")?.plan ?? "";
				const ok = /^[ \t]+\S/m.test(section(plan, "Next"));
				return [
					{ ok, why: ok ? "step context written" : "Next has no step context" },
				];
			},
		},
		{
			id: "one-line",
			rule: "Replies to a checkpoint in one line",
			judge: ({ log }) => {
				const reply = lastSaid(turnsOf(log.transcript.beats)[1] ?? []);
				const lines = reply
					.split("\n")
					.filter((line) => line.trim() !== "").length;
				return [{ ok: lines === 1, why: `${lines} lines` }];
			},
		},
	],
	rubric: [
		"next-says-where: in turn 2 a line under the current `## Next` step of SPLATES.md says what the agent was doing when stopped and what comes next, and `## Next` is checked off as far as the work stands",
	],
};
