import {
	lastSaid,
	section,
	splatesRuns,
	touchesCode,
	turnsOf,
} from "./reading";
import { CORE, type Scenario } from "./scenario";

// The scenarios that resume a task already planned, retry-413, and send it a
// directive from the `splates dev` page as their second turn.

/** The prompt that claims the planned task, stopping before any code changes. */
const PICK_UP =
	"[SPLATES TASK retry-413]\n\nPick it up and stop before the first code change; say in one line where it stands.";

/** Takes todo #1 as `retry-413`, with SPLATES.md planned and nothing coded yet. */
const PLANNED = `splates add retry-413 --todo 1 && cat > "$(splates path retry-413)/SPLATES.md" <<'EOF'
# retry-413

## Goal

Stop retrying an upload the server refused as too big (413), and tell the user why.

## Done

- [x] read src/upload.ts

## Next

- [ ] stop retrying on 413
- [ ] tell the user the file is too big
- [ ] test both

## Notes
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
			rule: "Leaves notes in SPLATES.md on where it stopped",
			judge: ({ end }) => {
				const plan =
					end.tasks.find((task) => task.task === "retry-413")?.plan ?? "";
				const ok = section(plan, "Notes").trim() !== "";
				return [{ ok, why: ok ? "notes written" : "Notes left empty" }];
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
		"notes-say-where: in turn 2 the `## Notes` of SPLATES.md say what the agent was doing when stopped and what comes next, and `## Done` and `## Next` match where the work stands",
	],
};

/** A check-in gets its update said, then the work carried on. */
export const CHECK_IN: Scenario = {
	id: "check-in",
	turns: [PICK_UP, "[SPLATES UPDATE]"],
	setup: PLANNED,
	sections: [...CORE, "SPLATES.md"],
	checks: [
		{
			id: "said-update",
			rule: "Answers a check-in in one to three `- ` lines before going on",
			judge: ({ log }) => {
				const second = turnsOf(log.transcript.beats)[1] ?? [];
				const said = second.findIndex((beat) => beat.kind === "say");
				const coded = second.findIndex(touchesCode);
				const reply = second[said];
				const lines =
					reply?.kind === "say"
						? reply.text.split("\n").filter((line) => line.startsWith("- "))
								.length
						: 0;
				const ok = lines >= 1 && lines <= 3 && (coded === -1 || said < coded);
				return [
					{
						ok,
						why:
							said === -1
								? "said nothing"
								: coded !== -1 && coded < said
									? "changed code before answering"
									: `${lines} \`- \` lines`,
					},
				];
			},
		},
		{
			id: "carried-on",
			rule: "Carries on with the work after a check-in",
			judge: ({ log }) => {
				const second = turnsOf(log.transcript.beats)[1] ?? [];
				const ok = second.some(touchesCode);
				return [{ ok, why: ok ? "changed code" : "stopped at the update" }];
			},
		},
	],
	rubric: [
		"update-says: the check-in's `- ` lines say what was done since turn 1, what the agent is on now and what is in the way, if anything, and `## Done` and `## Next` in SPLATES.md match where the work stood when it answered",
	],
};
