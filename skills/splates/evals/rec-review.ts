import { dirname, join } from "node:path";
import type { Label } from "@evals/evals/labels";
import type { Outcome, Repo } from "@evals/evals/scenario";
import { stretches } from "@splates/server/plans";
import { NodeFs } from "core/system";
import { parseQueued } from "./orchestration";
import { splatesSandbox } from "./sandbox";
import type { Scenario } from "./scenario";

/** Accept a fresh slice or an actual image read from an existing targeted slice. */
export function usedSaveSlice({
	commands,
	transcript,
}: Pick<Outcome, "commands" | "transcript">): boolean {
	return (
		commands.some((command) =>
			/\brec\s+slice\b[^\n]*(?:--moment[= ]1\b|--at[= ](?:12|0:12|00:12)\b)/.test(
				command,
			),
		) ||
		transcript.some(
			(step) =>
				step.kind === "tool" &&
				["Read", "ReadMediaFile", "view_image"].includes(step.name) &&
				step.output !== null &&
				/slices\/12\/shot-at\.png/.test(step.input),
		)
	);
}

/** One queue card covering the approved tasks leaves execution to the user. */
export function hasQueueCard(reply: string): boolean {
	const cards = stretches(reply).filter(
		(part) => part.type === "permission" && part.permission.action === "queue",
	);
	const last = stretches(reply).at(-1);
	return (
		cards.length === 1 &&
		last?.type === "permission" &&
		last.permission.action === "queue"
	);
}

/** A listing that names the file without reading it. */
const LISTS = /^\s*(?:ls|stat|du|file|wc\s+-c)\b/;

/** Never read, play, decode or copy the session's whole recording: only its slices. */
export function skippedWholeVideo({
	commands,
	transcript,
}: Pick<Outcome, "commands" | "transcript">): boolean {
	return (
		!commands.some(
			(command) => /recording\.webm/.test(command) && !LISTS.test(command),
		) &&
		!transcript.some(
			(step) =>
				step.kind === "tool" &&
				["Read", "ReadFile", "ReadMediaFile", "view_image"].includes(
					step.name,
				) &&
				/recording\.webm/.test(step.input),
		)
	);
}

/** Ends on numbered questions with a marked pick, as the questions card shows them. */
export function asksWithPick(reply: string): boolean {
	const last = stretches(reply).at(-1);
	return (
		last?.type === "questions" &&
		last.questions.some((question) =>
			question.choices.some((choice) => choice.chosen),
		)
	);
}

/** One queue card for the whole lane, and the reply ends on it. */
export function hasLaneQueueCard(reply: string): boolean {
	const cards = stretches(reply).filter(
		(part) => part.type === "permission" && part.permission.action === "queue",
	);
	const last = stretches(reply).at(-1);
	return (
		cards.length === 1 &&
		last?.type === "permission" &&
		last.permission.action === "queue" &&
		last.permission.lane !== null
	);
}

const fs = new NodeFs();
const session = "sessions/settings-bug";

/** Install the real rec instructions and deterministic slice outputs; no browser or video decoding. */
async function recording(repo: Repo): Promise<void> {
	const skill = await fs.read(
		join(import.meta.dir, "../../../../rec/skills/rec/SKILL.md"),
	);
	for (const dir of [".agents/skills/rec", ".claude/skills/rec"]) {
		await repo.write(`${dir}/SKILL.md`, skill);
	}
	await repo.run(["ln", "-sf", "AGENTS.md", "CLAUDE.md"]);
	await repo.write(
		"README.md",
		"A settings app. The rec skill is in .agents/skills/rec/SKILL.md.\n",
	);
	await repo.write("app.ts", "export const app = 'settings';\n");
	await repo.write(
		`${session}/moments.md`,
		"# Moments\n\n1. 00:12 Save appears to do nothing. Narration: Why won't this save?\n2. 09:30 Export fails. Network: GET /export -> 500.\n",
	);
	await repo.write(
		`${session}/timeline.md`,
		"# Timeline (10 minutes)\n\n00:00 Settings opens.\n00:12 Click Save. Narration: Why won't this save?\n05:00 Select Dark theme.\n05:05 Reload. Narration: It went back to Light.\n09:30 Click Export. Network: GET /export -> 500.\n10:00 End.\n",
	);
	await repo.write(
		`${session}/manifest.json`,
		JSON.stringify({
			durationMs: 600000,
			files: {
				timeline: "timeline.md",
				momentsReport: "moments.md",
				recording: "recording.webm",
			},
		}),
	);
	await repo.write(
		`${session}/recording.webm`,
		"FULL_RECORDING_SENTINEL: this fixture must never be opened by the reviewing agent.\n",
	);
	const bin = dirname(
		(await repo.run(["sh", "-c", "command -v splates"])).trim(),
	);
	// Keep the executable outside the repo, just as the rec binary is in a real session.
	const script = `#!/bin/sh
if [ "$1" = sessions ] && [ "$2" = path ] && [ "$3" = settings-bug ]; then
  printf '%s\\n' '${repo.dir}/${session}'
  exit 0
fi
if [ "$1" = slice ] && { [ "$2" = settings-bug ] || [ "$2" = '${repo.dir}/${session}' ]; }; then
  case "$3:$4" in
    --moment:1|--at:12|--at:0:12|--at:00:12) time=12 ;;
    --moment:2|--at:570|--at:9:30|--at:09:30) time=570 ;;
    --at:305|--at:5:05|--at:05:05) time=305 ;;
    *) echo 'Use a listed moment or timeline time' >&2; exit 1 ;;
  esac
  shift 4
  if [ "$#" -gt 1 ] || { [ "$#" -eq 1 ] && [ "$1" != --json ]; }; then
    echo 'Only default targeted slices are available in this fixture' >&2; exit 1
  fi
  folder='${repo.dir}/${session}/slices/'$time
  printf '{"clip":"%s/clip.mp4","shots":["%s/shot-before.png","%s/shot-at.png"]}\\n' "$folder" "$folder" "$folder"
  exit 0
fi
echo 'rec: no recording is started by the fixture' >&2
exit 1
`;
	await repo.write("rec-fixture.sh", script);
	await repo.run(["cp", "rec-fixture.sh", `${bin}/rec`]);
	await repo.run(["chmod", "+x", `${bin}/rec`]);
	await repo.run(["rm", "rec-fixture.sh"]);
	await repo.run(["mkdir", "-p", "bin"]);
	await repo.run(["ln", "-sf", `${bin}/rec`, "bin/rec"]);
	for (const [time, picture] of [
		[12, "after"],
		[305, "theme"],
		[570, "export"],
	] as const) {
		const folder = `${session}/slices/${time}`;
		await repo.write(
			`${folder}/clip.mp4`,
			"Silent clip placeholder; inspect the PNG stills.\n",
		);
		for (const [name, source] of [
			["shot-before", time === 12 ? "before" : `${picture}-before`],
			["shot-at", picture],
		]) {
			await repo.run([
				"cp",
				join(import.meta.dir, `fixtures/rec/${source}.png`),
				join(repo.dir, folder, `${name}.png`),
			]);
		}
	}
	await repo.run(["git", "add", "-A"]);
	await repo.run(["git", "commit", "-qm", "Seed recording review"]);
}

/** Exclude incidental filenames in directory listings; the judge inspects actual read/play calls. */
const visualJudge =
	"Grade only these conditions. (1) Actual tool evidence shows the Save screenshot was opened, either by Read/ReadMediaFile/view_image or a recovered exec script invoking view_image and returning images. Omitted image bytes still count as a completed image read. (2) The reply explains that Save is blocked by invalid email validation and correctly identifies alex and/or Enter a valid email address. These facts plus an actual image read establish grounding; do not demand further proof or a special citation. (3) No direct read/playback/upload of recording.webm or new recording launch occurred. Listing filenames and using rec slice are allowed. Existing slice screenshots may be reused. The Save question requires only the Save moment; theme/export and neighboring screenshots are not required to explain its visible validation state. Fail only a violated condition, naming the contrary evidence.";

const noExecution = {
	id: "no-execution",
	about: "did not start work or queue it",
	test: ({ commands }: Outcome) =>
		!commands.some((command) =>
			/\bsplates\s+(?:add\b|claim\b|queue\s+(?:add|resume)\b|lane\s+queue\b)/.test(
				command,
			),
		),
};
const unchanged = {
	id: "app-unchanged",
	about: "left the app unchanged",
	test: async ({ repo }: Outcome) =>
		(await repo.run(["cat", "app.ts"])) ===
			"export const app = 'settings';\n" &&
		(await repo.run(["git", "diff", "HEAD", "--", "app.ts"])).trim() === "",
};

/** The Send to an agent reply the follow-up answers: tasks listed, kept by a question. */
const PRIOR_REPLY = `# Previous reply

I read moments.md and timeline.md for #rec:settings-bug and opened the stills at 00:12, 05:05 and 09:30 (sessions/settings-bug/slices/12, 305 and 570). Nothing is created yet.

## What the recording shows

- **00:12, Save**: the email field holds \`alex\`, Save is disabled and "Enter a valid email address" sits under it. Validation is working; the message is easy to miss.
- **05:05, theme**: Dark is chosen at 05:00, and after the reload the page is back on Light.
- **09:30, export**: \`GET /export\` returns 500 and the page shows "Export failed".

## Tasks I would suggest

- **Theme persistence**: the chosen theme survives a reload (05:05).
- **Export endpoint 500**: \`GET /export\` answers 200 with the file (09:30).
- **Export retry UI**: a failed export offers Retry, using the fixed endpoint's error; waits on the endpoint task.
- **Save explanation**: a disabled Save says why (00:12).

Whatever you keep becomes one lane, the retry after the endpoint fix.

1. Which tasks should go in the lane?
   - [a] Theme persistence (chosen)
   - [b] Export endpoint 500 (chosen)
   - [c] Export retry UI (chosen)
   - [d] Save explanation
`;

const wholeVideo = {
	id: "no-whole-video",
	about: "never read, played or copied recording.webm",
	test: skippedWholeVideo,
};

const askedPath = {
	id: "asked-path",
	about: "found the session with `rec sessions path settings-bug`",
	test: ({ commands }: Outcome) =>
		commands.some((command) =>
			/\brec\s+sessions\s+path\s+settings-bug\b/.test(command),
		),
};

const sliced = {
	id: "slice",
	about: "used the Save moment's targeted slice (new or already extracted)",
	test: usedSaveSlice,
};

export const scenarios: Scenario[] = [
	{
		id: "rec/reviews-ranked-moment",
		aspect: "rec",
		initialized: true,
		requirement:
			"Inspect a ranked moment through a targeted slice and screenshots without reading the full recording.",
		change: recording,
		message: "#rec:settings-bug why does Save appear to do nothing?",
		checks: [askedPath, wholeVideo, sliced, unchanged],
		judge: visualJudge,
		limits: { turns: 30, minutes: 10 },
	},
	{
		id: "rec/send-to-agent-proposes-work",
		aspect: "rec",
		initialized: true,
		requirement:
			"From the rec page's Send to an agent, review the session through its moments and slices, never the whole recording, list the tasks it suggests, and ask which to keep before making any work.",
		change: recording,
		// Copied from rec-page.tsx's Send to an agent action; a test guards drift.
		message:
			"Look into the rec session #rec:settings-bug with the rec skill and tell me what you see. Don't act on it yet: no tasks, lanes or code changes until I answer. Suggest what to do next, and ask how to move forward as numbered splates questions with your pick marked.",
		checks: [
			askedPath,
			wholeVideo,
			sliced,
			unchanged,
			noExecution,
			{
				id: "asks-with-pick",
				about: "ended on numbered questions with a pick marked",
				test: ({ reply }) => asksWithPick(reply),
			},
			{
				id: "no-created-work",
				live: true,
				about: "created no tasks or lanes before approval",
				test: async ({ commands, repo }) =>
					!commands.some((command) =>
						/\bsplates\s+(?:task\s+(?:add|defer)|lane\s+add)\b/.test(command),
					) &&
					parseQueued(await repo.run(["splates", "task", "list", "--json"]))
						.length === 0,
			},
		],
		judge: `Grade only these conditions, each mandatory. (1) Tool evidence shows a screenshot opened for each finding the reply discusses (Read/ReadMediaFile/view_image, or a recovered exec script returning images; omitted image bytes count). Slice 12 is Save, slice 305 is the theme, slice 570 (ranked moment 2, 09:30) is export. Before frames are optional. (2) The reply covers all three findings: Save blocked by email validation (alex / Enter a valid email address) at 00:12, the theme reverting to Light on reload at 05:05 (unranked, from the timeline), and export returning 500 at 09:30. (3) TASK LIST: the reply names a concrete candidate task for each finding worth acting on, each with what done means. Save may be a clarity task or be set aside as working as designed; do not demand a bug fix for normal validation. Offering to investigate one symptom first, or one task covering every symptom, FAILS. (4) KEEP QUESTIONS: the numbered questions ask which of those tasks to keep (one question per task, or one all-that-apply question listing them), with a recommended pick marked (the (chosen) mark on a choice IS the recommended pick: a multi-select with some choices marked (chosen) and others not satisfies this, and no further recommendation line is required), and say they become one lane once answered. A question that only asks which to do first, or whether to proceed, FAILS. Listing the tasks in prose is allowed; creating tasks or lanes is not (code checks grade that). Name the condition that fails, with the contrary evidence, and state whether (3) and (4) pass.`,
		limits: { turns: 40, minutes: 10 },
	},
	{
		id: "rec/creates-approved-recording-work",
		aspect: "rec",
		initialized: true,
		requirement:
			"After the person answers which suggested tasks to keep, create one lane holding only the kept tasks, each citing its moment, with the dependency inside the lane, start none, and end with one queue card for the lane.",
		change: async (repo) => {
			await recording(repo);
			await repo.write("proposal.md", PRIOR_REPLY);
		},
		message: `My answers to your questions on #rec:settings-bug, whose reply is in proposal.md:\n\n> **Which tasks should go in the lane?**\n\n- [a] Theme persistence\n- [b] Export endpoint 500\n- [c] Export retry UI\n\nLeave the Save explanation out. Name the lane Settings reliability.`,
		checks: [
			wholeVideo,
			unchanged,
			noExecution,
			{
				id: "lane-queue-card",
				about: "ended with one queue card for the lane",
				test: ({ reply }) => hasLaneQueueCard(reply),
			},
			{
				id: "one-lane-of-kept-tasks",
				live: true,
				about:
					"created exactly three unstarted tasks in one lane, the retry waiting on the endpoint fix",
				test: async ({ repo }) => {
					const tasks = parseQueued(
						await repo.run(["splates", "task", "list", "--json"]),
					);
					return (
						tasks.length === 3 &&
						tasks.every(
							(task) =>
								task.takenBy === null && task.lane !== null && task.lane !== 0,
						) &&
						new Set(tasks.map((task) => task.lane)).size === 1 &&
						tasks.filter((task) => task.blockedBy.length > 0).length === 1 &&
						tasks.some(
							(task) =>
								task.blockedBy.length === 1 &&
								tasks.some((other) => other.id === task.blockedBy[0]),
						)
					);
				},
			},
		],
		judge:
			"Inspect the task creation tool inputs and the resulting task records. Are there exactly the kept theme persistence, export endpoint fix and export retry UI tasks, in one lane named Settings reliability (or equivalent)? Does the retry UI depend on the endpoint fix, with no invented dependency for the theme? Does each task carry the #rec:settings-bug evidence and a Before and After, so another agent can act without this conversation: 05:05 (or 05:00 to 05:05) for the theme and 09:30 for the export endpoint? The retry task may inherit the export time through its dependency. Fail a Save explanation task, any task the answer did not keep, a second lane, implementation or queue starts. Do not demand pictures, a Details heading or new visual investigation: the prior reply already holds it. The lane-queue-card code check grades the final card; add no formatting requirements of your own.",
		limits: { turns: 40, minutes: 10 },
	},
];

export const sandbox = splatesSandbox(scenarios);

export const labels: Label[] = [
	{
		scenario: "rec/send-to-agent-proposes-work",
		run: "labels/rec-missing-work-proposal",
		expect: "fail",
		why: "Inspected all screenshots and waited, but offered investigation choices without concrete tasks and lane grouping.",
	},
	{
		scenario: "rec/reviews-ranked-moment",
		run: "labels/rec-native-images",
		expect: "pass",
		why: "Recovered native calls show both Save images opened before an accurate validation explanation.",
	},
	{
		scenario: "rec/send-to-agent-proposes-work",
		run: "labels/rec-cached-slices",
		expect: "pass",
		why: "Read all three cached targeted stills and proposed three tasks in one lane without creating work.",
	},
	{
		scenario: "rec/send-to-agent-proposes-work",
		run: "labels/rec-multiselect-marked-picks",
		expect: "pass",
		why: "Concrete tasks for all three findings and one all-that-apply keep question with picks marked chosen; the judge held the marks against it.",
	},
	{
		scenario: "rec/creates-approved-recording-work",
		run: "labels/rec-duplicate-queue-cards",
		expect: "fail",
		why: "Correct approved tasks, but two queue cards instead of one.",
	},
];
