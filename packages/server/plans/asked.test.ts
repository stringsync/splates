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
					demo: {
						title: "an old upload link",
						intro:
							"Open http://localhost:4310 (a copy of staging's uploads, nothing of yours).",
						steps: [
							{
								number: "1",
								action: "Open `/u/old-link`.",
								expect: "The file downloads from the new storage.",
							},
						],
					},
					checks: ["bun run typecheck", "bun test"],
					failed: [],
					details: "",
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

	it("reads the skill's proposal, and the calls it rests on as its questions", async () => {
		const proposal = await skillExample("## 💡 Proposed");

		expect(stretches(proposal)).toEqual([
			{
				type: "proposal",
				proposal: {
					subject: "a card for proposals",
					body: "Fold proposals into the questions card, each call a question with a pick:\nthat card already tags a `(chosen)` choice, so one card asks everything.",
				},
			},
			{
				type: "questions",
				questions: [
					expect.objectContaining({
						number: "1",
						text: "Where should a proposal's calls come from?",
						choices: [
							expect.objectContaining({ key: "a", chosen: true }),
							expect.objectContaining({ key: "b", chosen: false }),
						],
					}),
					expect.objectContaining({
						number: "2",
						text: "What should its button say?",
						choices: [],
					}),
				],
			},
		]);
	});

	it("reads the skill's merge and remove reports", async () => {
		const merged = await skillExample("## ✅ Merged");
		const removed = await skillExample("## 🛑 Removed");

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
					"## 🛑 Removed <task>: superseded by a fix on main\n\nThe task set out to stop uploads retrying a 413.",
			},
		});
	});

	it("reads the skill's deferred report as its own ending", async () => {
		const deferred = await skillExample("## ⏸ Deferred");

		expect(stretches(deferred)[0]).toMatchObject({
			report: {
				ending: "deferred",
				task: "<task>",
				reason: "waiting on the upload rewrite",
			},
		});
	});

	it("reads a working report, naming the task", () => {
		expect(stretches("## ⏳ Working lanes-fix\n\nOut.")[0]).toMatchObject({
			report: { ending: "working", task: "lanes-fix", reason: null },
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

	it("reads the skill's own demo, alone in a message, as a demo", async () => {
		const example = await skillExample("### 🎬 Demo");

		const found = stretches(example);

		expect(found.map((each) => each.type)).toEqual(["demo"]);
		const steps = found[0]?.type === "demo" ? found[0].demo.steps : [];
		expect(steps.map((step) => [step.action, step.expect])).toEqual([
			["Press and hold a card.", "It lifts after half a second."],
			[
				"Drag it to another lane.",
				"It lands where you drop it.\n![dropped in Doing](/abs/path/drop.png)",
			],
		]);
	});

	it("ends a demo with its steps, leaving what follows as text", () => {
		expect(
			stretches(
				[
					"### 🎬 Demo",
					"",
					"1. Open the board.",
					"",
					"   It loads.",
					"2. Reload.",
					"",
					"That is all.",
				].join("\n"),
			),
		).toEqual([
			{
				type: "demo",
				demo: {
					title: null,
					intro: "",
					steps: [
						{ number: "1", action: "Open the board.", expect: "It loads." },
						{ number: "2", action: "Reload.", expect: "" },
					],
				},
			},
			{ type: "text", text: "That is all." },
		]);
	});

	it("reads a proposed task anywhere in a message, up to the next heading or questions", () => {
		const found = stretches(
			[
				"Next up:",
				"",
				"### 📝 Upload retries forever on a 413 [#12]",
				"",
				"The client retries every 4xx. It touches the retry loop.",
				"",
				"### 📝 Show the file size limit [#14]",
				"",
				"Says how big a file may be.",
				"",
				"1. Which first?",
			].join("\n"),
		);

		expect(found).toEqual([
			{ type: "text", text: "Next up:" },
			{
				type: "todo",
				todo: {
					id: 12,
					subject: "Upload retries forever on a 413",
					body: "The client retries every 4xx. It touches the retry loop.",
				},
			},
			{
				type: "todo",
				todo: {
					id: 14,
					subject: "Show the file size limit",
					body: "Says how big a file may be.",
				},
			},
			expect.objectContaining({ type: "questions" }),
		]);
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
				"## 🔐 Permission: remove lane 5: Old ideas",
				"",
				"`splates lane remove 5`",
				"",
				"Nothing in it is wanted.",
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
					action: "remove-lane",
					lane: 5,
					tasks: [],
					title: "Old ideas",
					body: "Nothing in it is wanted.",
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

	it("reads a run evals permission with its probes and baseline", () => {
		const found = stretches(
			[
				"## 🔐 Permission: run evals splates: the decision probes",
				"",
				"Checks the new wording.",
				"",
				"- `decisions/local-choice` the local one",
				"- `decisions/ask-first`",
				"",
				"Baseline: `main`",
			].join("\n"),
		);

		expect(found).toEqual([
			{
				type: "permission",
				permission: {
					action: "run-evals",
					lane: null,
					tasks: [],
					title: "the decision probes",
					body: "Checks the new wording.",
					evals: {
						skill: "splates",
						probes: ["decisions/local-choice", "decisions/ask-first"],
						baseline: "main",
					},
				},
			},
		]);
	});

	it("ends a proposed task at its paragraph, leaving the message after it as text", () => {
		const found = stretches(
			[
				"### 📝 Install scry from npm [#162]",
				"",
				"No open task relates to this lane,",
				"and this one is at the top of the list.",
				"",
				"Now for your question.",
				"",
				"- One real miss.",
			].join("\n"),
		);

		expect(found).toEqual([
			{
				type: "todo",
				todo: {
					id: 162,
					subject: "Install scry from npm",
					body: "No open task relates to this lane,\nand this one is at the top of the list.",
				},
			},
			{ type: "text", text: "Now for your question.\n\n- One real miss." },
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
				"",
				'Reply "merge", or say what to change.',
			].join("\n"),
		);

		expect(stretch).toEqual({
			type: "review",
			review: {
				task: "header",
				base: "main",
				summary: "The header wraps on phones.",
				demo: null,
				checks: ["bun run typecheck", "bun test"],
				failed: ["bun run lint"],
				details:
					"It breaks at 390px rather than 420px.\n\nThe old breakpoint stays for tablets.",
			},
		});
	});

	it("leaves a review title without the line every review ends with as text", () => {
		const text = "## 🔍 Ready to merge header onto main\n\nStill going.";
		expect(stretches(text)).toEqual([{ type: "text", text }]);
	});

	it("reads a proposal that rests on no calls, up to the next heading", () => {
		expect(
			stretches(
				[
					"Here is what I would do.",
					"",
					"## 💡 Proposed a wider header",
					"",
					"Let the header wrap at 390px.",
					"",
					"#### It overflows today.",
					"",
					"- The menu runs off the edge.",
					"",
					"### 📝 Header overflows [#4]",
					"",
					"It is the same header.",
				].join("\n"),
			),
		).toEqual([
			{ type: "text", text: "Here is what I would do." },
			{
				type: "proposal",
				proposal: {
					subject: "a wider header",
					body: "Let the header wrap at 390px.\n\n#### It overflows today.\n\n- The menu runs off the edge.",
				},
			},
			{
				type: "todo",
				todo: {
					id: 4,
					subject: "Header overflows",
					body: "It is the same header.",
				},
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
