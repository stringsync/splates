import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { stretches } from "./asked";

describe("stretches", () => {
	it("reads the questions of the skill's own example of a turn ending on them", async () => {
		const example = await skillExample("The board can now mark a stale task");

		const found = stretches(example);

		expect(found.map((each) => each.type)).toEqual(["text", "questions"]);
		const questions = found[1]?.type === "questions" ? found[1].questions : [];
		expect(
			questions.map(({ number, text, body, choices, pick }) => ({
				number,
				text,
				body,
				choices,
				pick,
			})),
		).toEqual([
			{
				number: "1",
				text: "How should a stale task be shown?",
				body: "",
				choices: [
					{
						key: "a",
						text: "A muted card",
						body: "![muted card](/abs/path/muted.png)",
						why: "",
						chosen: true,
					},
					{
						key: "b",
						text: 'A "stale" badge',
						body: "![stale badge](/abs/path/badge.png)",
						why: "",
						chosen: false,
					},
				],
				pick: "one",
			},
		]);
	});

	it("reads the skill's own review report as a review, and nothing else as one", async () => {
		const review = await skillExample("## 🔍");

		expect(stretches(review)).toEqual([
			{
				type: "review",
				review: {
					task: "<task>",
					base: "<base>",
					summary:
						"Old upload links now redirect to the new storage, after a migration that moves every stored file.",
					checks: ["bun run typecheck", "bun test"],
					failed: [],
					details: "![an old upload link downloading](/abs/path/old-link.png)",
				},
			},
		]);
		expect(
			(await skillExamples())
				.filter((each) => each !== review)
				.flatMap((each) => stretches(each))
				.filter((each) => each.type === "review"),
		).toEqual([]);
	});

	it("reads the skill's Done report, an automation run's, with no task", async () => {
		const done = await skillExample("## ✅ Done");

		expect(stretches(done)).toEqual([
			{
				type: "report",
				report: {
					ending: "done",
					task: "",
					base: null,
					reason: "two merged tasks reviewed, nothing to fix",
					body: "Both kept their tests; the notes needed no change.",
					source:
						"## ✅ Done: two merged tasks reviewed, nothing to fix\n\nBoth kept their tests; the notes needed no change.",
				},
			},
		]);
	});

	it("reads the skill's merge and remove reports", async () => {
		const merged = await skillExample("## ✅ Merged");
		const removed = await skillExample("## 🧹 Removed");

		expect(stretches(merged).map((each) => each.type)).toEqual(["report"]);
		expect(stretches(merged)[0]).toEqual({
			type: "report",
			report: {
				ending: "merged",
				task: "<task>",
				base: "<base>",
				reason: null,
				body: "Cards on a phone now drag on a long press. Restart `splates server` to pick it up.",
				source:
					"## ✅ Merged <task> onto <base>\n\nCards on a phone now drag on a long press. Restart `splates server` to pick it up.",
			},
		});
		expect(stretches(removed)[0]).toEqual({
			type: "report",
			report: {
				ending: "removed",
				task: "<task>",
				base: null,
				reason: "superseded by a fix on main",
				body: "The task set out to stop uploads retrying a 413.",
				source:
					"## 🧹 Removed <task>: superseded by a fix on main\n\nThe task set out to stop uploads retrying a 413.",
			},
		});
	});

	it("reads the skill's deferred report as its own ending", async () => {
		const deferred = await skillExample("## ⏸ Blocked");

		expect(stretches(deferred)[0]).toMatchObject({
			report: {
				ending: "deferred",
				task: "<task>",
				reason: "waiting on #812 and #813",
			},
		});
	});

	it("leaves a lanes report from before lanes stopped running as words, still reading the questions after it", () => {
		const example = [
			"## ⏸️ Waiting lanes Stats: on stats-breakdowns-clear",
			"",
			"Answer stats-breakdowns-clear's question on the breakdown tables.",
			"",
			"1. Which breakdown should lead the table?",
			"   - (a) By project (chosen)",
			"   - (b) By agent",
		].join("\n");

		expect(stretches(example).map((each) => each.type)).toEqual([
			"text",
			"questions",
		]);
	});

	it("leaves a title saying a task was added as words, since splates draws that itself", () => {
		const text = "## 🌱 Added upload-413\n\nStop retrying a 413.";

		expect(stretches(text)).toEqual([{ type: "text", text }]);
	});

	it("reads work to queue, a lane whole or tasks one by one, leaving out the command the card shows on its own", () => {
		const found = stretches(
			[
				"## 🔐 Permission: queue lane 3: Billing export",
				"",
				"`splates lane queue 3`",
				"",
				"Four tasks, the CSV writer first.",
				"",
				"## 📥 Queue #12, #14",
				"",
				"Two fixes to uploads.",
				"",
				"## 🔐 Permission: queue #12, #14",
				"",
				"Two fixes to uploads.",
			].join("\n"),
		);

		expect(found).toEqual([
			{
				type: "permission",
				permission: {
					action: "queue",
					lane: 3,
					tasks: [],
					title: "Billing export",
					body: "Four tasks, the CSV writer first.",
				},
			},
			{
				type: "permission",
				permission: {
					action: "queue",
					lane: null,
					tasks: [12, 14],
					title: null,
					body: "Two fixes to uploads.",
				},
			},
			{
				type: "permission",
				permission: {
					action: "queue",
					lane: null,
					tasks: [12, 14],
					title: null,
					body: "Two fixes to uploads.",
				},
			},
		]);
	});

	it("leaves a remove-lane permission heading as words, since that card is gone", () => {
		const text =
			"## 🔐 Permission: remove lane 5: Old ideas\n\n`splates lane remove 5`\n\nNothing in it is wanted.";

		expect(stretches(text)).toEqual([{ type: "text", text }]);
	});

	it("reads another project's queue card", () => {
		const found = stretches(
			[
				"## 🔐 Permission: queue wren #404: A locale for format()",
				"",
				"`splates --project wren queue add 404`",
				"",
				"The report page needs it.",
			].join("\n"),
		);

		expect(found).toEqual([
			{
				type: "permission",
				permission: {
					action: "queue",
					lane: null,
					tasks: [404],
					project: "wren",
					title: "A locale for format()",
					body: "The report page needs it.",
				},
			},
		]);
	});

	it("reads an escalation without a reason, or with its emoji's variation selector left off", () => {
		expect(stretches("## ⚠ Escalated header")).toEqual([
			{
				type: "report",
				report: {
					ending: "escalated",
					task: "header",
					base: null,
					reason: null,
					body: "",
					source: "## ⚠ Escalated header",
				},
			},
		]);
	});

	it("reads a review's summary, checks, failed checks, and details wherever they stand", () => {
		const [stretch] = stretches(
			[
				"## 🔍 Ready to merge header onto main",
				"",
				"The header wraps on phones.",
				"",
				"It breaks at 390px rather than 420px.",
				"",
				"Checks: `bun run typecheck`, `bun test`",
				"",
				"Failed: `bun run lint`",
				"",
				"The old breakpoint stays for tablets.",
			].join("\n"),
		);

		expect(stretch).toEqual({
			type: "review",
			review: {
				task: "header",
				base: "main",
				summary: "The header wraps on phones.",
				checks: ["bun run typecheck", "bun test"],
				failed: ["bun run lint"],
				details:
					"It breaks at 390px rather than 420px.\n\nThe old breakpoint stays for tablets.",
			},
		});
	});

	it("ends a review at the next heading", () => {
		expect(
			stretches(
				"## 🔍 Ready to merge header onto main\n\nThe header wraps.\n\n## 🔐 Permission: queue #7: tablets\n\n`splates queue add 7`",
			)[0],
		).toEqual({
			type: "review",
			review: {
				task: "header",
				base: "main",
				summary: "The header wraps.",
				checks: [],
				failed: [],
				details: "",
			},
		});
	});

	it("leaves an older review's last line out of the card", () => {
		expect(
			stretches(
				'## 🔍 Ready to merge header onto main\n\nThe header wraps.\n\nReply "merge", or say what to change.\n\nAfter it.',
			),
		).toEqual([
			{
				type: "review",
				review: {
					task: "header",
					base: "main",
					summary: "The header wraps.",
					checks: [],
					failed: [],
					details: "",
				},
			},
			{ type: "text", text: "After it." },
		]);
	});

	it("reads an old proposal's heading as text above ordinary questions", () => {
		expect(
			stretches(
				"## 💡 Proposed a wider header\n\nLet it wrap.\n\n1. Wrap at 390px?\n   - (a) Yes (chosen)",
			),
		).toEqual([
			{ type: "text", text: "## 💡 Proposed a wider header\n\nLet it wrap." },
			{
				type: "questions",
				questions: [expect.objectContaining({ text: "Wrap at 390px?" })],
			},
		]);
	});
});

/**
 * The report examples the splates skill shows agents, as agents copy them,
 * from its SKILL.md and every reference file alike.
 */
async function skillExamples(): Promise<string[]> {
	const dir = join(import.meta.dir, "../../../skills/splates");
	const files = await Array.fromAsync(new Bun.Glob("**/*.md").scan(dir));
	const texts = await Promise.all(
		files.toSorted().map((file) => Bun.file(join(dir, file)).text()),
	);
	return texts.flatMap((skill) =>
		[...skill.matchAll(/```markdown\n([\s\S]*?)\n```/g)].map(
			(match) => match[1] as string,
		),
	);
}

/** The skill's example that starts with `title`; a skill without one fails. */
async function skillExample(title: string): Promise<string> {
	const example = (await skillExamples()).find((each) =>
		each.startsWith(title),
	);
	if (example === undefined) {
		throw new Error(`the skill has no example titled ${title}`);
	}
	return example;
}
