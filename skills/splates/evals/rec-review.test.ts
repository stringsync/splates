import { expect, it } from "bun:test";
import { join } from "node:path";
import { stretches } from "@splates/server/plans";
import { NodeFs } from "core/system";
import {
	asksWithPick,
	hasLaneQueueCard,
	hasQueueCard,
	sandbox,
	scenarios,
	skippedWholeVideo,
	usedSaveSlice,
} from "./rec-review";

it("uses the Rec page's actual send-to-agent message", async () => {
	const page = await new NodeFs().read(
		join(import.meta.dir, "../../../packages/web/rec-page.tsx"),
	);
	const message = page.match(/`(Look into the rec session #rec:[^`]*)`/)?.[1];
	expect(message).toBeDefined();
	expect(
		scenarios.find((each) => each.id === "rec/send-to-agent-proposes-work")
			?.message,
	).toBe(message?.replace(/\$\{name\}/, "settings-bug"));
});

it.each(scenarios.filter((each) => each.id === "rec/reviews-ranked-moment"))(
	"supplies real screenshots, the rec skill and bounded slices in an isolated sandbox",
	async (scenario) => {
		const box = await sandbox(join(import.meta.dir, ".."), scenario);
		try {
			const { repo } = box;
			const path = (
				await repo.run(["rec", "sessions", "path", "settings-bug"])
			).trim();
			expect(path).toBe(join(repo.dir, "sessions/settings-bug"));
			const slice = JSON.parse(
				await repo.run([
					"rec",
					"slice",
					"settings-bug",
					"--moment",
					"1",
					"--json",
				]),
			) as { shots: string[] };
			const signatures = await Promise.all(
				slice.shots.map(async (image) => [
					...(await new NodeFs().readBytes(image)).slice(0, 8),
				]),
			);
			expect(signatures).toEqual([
				[137, 80, 78, 71, 13, 10, 26, 10],
				[137, 80, 78, 71, 13, 10, 26, 10],
			]);
			expect(await repo.run(["cat", ".agents/skills/rec/SKILL.md"])).toContain(
				"Do not read `recording.webm` itself.",
			);
			const refused = await Promise.allSettled([
				repo.run([
					"rec",
					"slice",
					"settings-bug",
					"--moment",
					"1",
					"--after",
					"600",
				]),
				repo.run(["rec", "--name", "new-recording"]),
			]);
			expect(refused.map((result) => result.status)).toEqual([
				"rejected",
				"rejected",
			]);
		} finally {
			await box.remove();
		}
	},
	30000,
);

it("accepts cached slice inspection, but not a filename listing or an unobserved claim", () => {
	expect(
		usedSaveSlice({
			commands: [],
			transcript: [
				{
					kind: "tool",
					name: "Read",
					input: '{"file_path":"sessions/settings-bug/slices/12/shot-at.png"}',
					output: '{"type":"image"}',
				},
			],
		}),
	).toBe(true);
	expect(
		usedSaveSlice({
			commands: ["ls sessions/settings-bug/slices/12"],
			transcript: [{ kind: "text", text: "I inspected slices/12/shot-at.png" }],
		}),
	).toBe(false);
	expect(
		usedSaveSlice({
			commands: ["bin/rec slice settings-bug --moment 1"],
			transcript: [],
		}),
	).toBe(true);
});

it("requires one final queue card and rejects the reporting failures in batch-vtt4CB", () => {
	const card =
		"## 🔐 Permission: queue #1, #2, #3: Reliability fixes\n\n`splates queue add 1 2 3`\n\nStarts the approved work.";
	expect(hasQueueCard(card)).toBe(true);
	expect(hasQueueCard("The queue is empty. Nothing started.")).toBe(false);
	expect(hasQueueCard(`${card}\n\n${card}`)).toBe(false);
});

it("fails any read, decode or copy of the whole recording, but not a listing", () => {
	const clean = { commands: ["ls -la sessions/settings-bug"], transcript: [] };
	expect(skippedWholeVideo(clean)).toBe(true);
	expect(
		skippedWholeVideo({
			commands: ["ls -la sessions/settings-bug/recording.webm"],
			transcript: [],
		}),
	).toBe(true);
	expect(
		[
			"ffmpeg -i sessions/settings-bug/recording.webm -vf fps=1 out/%d.png",
			"cp sessions/settings-bug/recording.webm /tmp/",
			"cat sessions/settings-bug/recording.webm",
		].map((command) =>
			skippedWholeVideo({ commands: [command], transcript: [] }),
		),
	).toEqual([false, false, false]);
	expect(
		skippedWholeVideo({
			commands: [],
			transcript: [
				{
					kind: "tool",
					name: "ReadMediaFile",
					input: '{"path":"sessions/settings-bug/recording.webm"}',
					output: "",
				},
			],
		}),
	).toBe(false);
});

it("wants the reply to end on questions with a pick, and a single lane queue card after approval", () => {
	const questions =
		"I see three tasks.\n\n1. Which tasks should go in the lane?\n   - [a] Theme persistence (chosen)\n   - [b] Export endpoint 500\n";
	expect(asksWithPick(questions)).toBe(true);
	expect(asksWithPick("I see three tasks. Which should I keep?")).toBe(false);
	const lane =
		"## 🔐 Permission: queue lane 1: Settings reliability\n\n`splates lane queue 1`\n\nThe three kept tasks.";
	expect(hasLaneQueueCard(lane)).toBe(true);
	expect(
		hasLaneQueueCard(
			"## 🔐 Permission: queue #1, #2, #3: Reliability fixes\n\n`splates queue add 1 2 3`\n\nStarts the approved work.",
		),
	).toBe(false);
});

it("seeds the follow-up with a prior reply whose question the page can show", async () => {
	const scenario = scenarios.find(
		(each) => each.id === "rec/creates-approved-recording-work",
	) as (typeof scenarios)[number];
	const box = await sandbox(join(import.meta.dir, ".."), scenario);
	try {
		const prior = await box.repo.run(["cat", "proposal.md"]);
		expect(stretches(prior).at(-1)).toMatchObject({
			type: "questions",
			questions: [{ pick: "any", choices: [{}, {}, {}, {}] }],
		});
	} finally {
		await box.remove();
	}
}, 30000);
