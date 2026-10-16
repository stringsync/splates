import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { stretches } from "./asked";
import { leftIn } from "./investigated";

describe("stretches", () => {
	it("reads the questions of the skill's own escalation example", async () => {
		const example = await skillExample("## ⚠️ Escalated");

		const found = stretches(example);

		expect(found.map((each) => each.type)).toEqual([
			"report",
			"demo",
			"questions",
		]);
		expect(found[0]).toEqual({
			type: "report",
			report: {
				ending: "escalated",
				task: "<task>",
				base: null,
				to: null,
				reason: "needs two calls on the todo board",
				body: "One sentence on what changed.\n\n#### A card drags on a phone only after a long press.\n\n- A short press still scrolls the lane.\n- The long press is half a second, as on the home screen.",
				source:
					"## ⚠️ Escalated <task>: needs two calls on the todo board\n\nOne sentence on what changed.\n\n#### A card drags on a phone only after a long press.\n\n- A short press still scrolls the lane.\n- The long press is half a second, as on the home screen.",
			},
		});
		expect(found[1]).toEqual({
			type: "demo",
			demo: {
				title: "dragging a card on a phone",
				intro:
					"Open http://localhost:4310 at 390px wide (a demo repo, nothing of yours).",
				steps: [
					{
						number: "1",
						action: "Press and hold a card, then drag it to another lane.",
						expect: "It lands where you drop it.",
					},
				],
			},
		});
		const questions = found[2]?.type === "questions" ? found[2].questions : [];
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
				text: "What feels off when dragging a card on a phone?",
				body: "",
				choices: [],
				pick: null,
			},
			{
				number: "2",
				text: "How should a stale todo be shown?",
				body: "",
				choices: [
					{
						key: "a",
						text: "A muted card",
						body: "![muted card](/abs/path/muted.png)",
						why: "",
						chosen: false,
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

	it("reads the skill's own Investigated report, each finding it left apart from what it fixed", async () => {
		const [stretch] = stretches(await skillExample("## 🔎"));

		expect(stretch).toMatchObject({
			type: "report",
			report: { ending: "investigated", task: "header-wrap" },
		});
		expect(
			stretch?.type === "report" ? leftIn(stretch.report.body) : null,
		).toEqual({
			fixed: "The header test no longer waits on a font that never loads.",
			left: [
				"The gate keeps failing on `wraps at 390px`: it needs a browser the gate does not run.",
			],
		});
	});

	it("reads the skill's own review report as a review, and nothing else as one", async () => {
		const review = await skillExample("## 🔍");

		expect(stretches(review)).toEqual([
			{
				type: "review",
				review: {
					task: "<task>",
					base: "<base>",
					summary: "One sentence on what changed.",
					demo: {
						title: "moving todos between lanes",
						intro:
							"Open http://localhost:4310 (a demo repo, nothing of yours).",
						steps: [
							{
								number: "1",
								action: "Drag a todo to another lane.",
								expect: "It lands where you drop it.",
							},
							{
								number: "2",
								action: "Reload.",
								expect:
									"It stays there.\n![the board after a drag](/abs/path/board.png)",
							},
						],
					},
					checks: ["bun run typecheck", "bun test"],
					failed: [],
					details:
						"#### A drop saves the todo's lane and position in one write.\n\n- A reload never shows it half moved.\n- A drop on its own spot writes nothing.",
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
					body: "Fold proposals into the questions card, each assumption a question already answered.\n\n#### An assumption is a question with an answer.\n\n- The questions card already tags a `(chosen)` choice.\n- It already heads its questions with an escalation's report.\n- One card then asks everything, answered or not.",
				},
			},
			{
				type: "questions",
				questions: [
					expect.objectContaining({
						number: "1",
						text: "Where should a proposal's assumptions come from?",
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

	it("reads the skill's merge and remove reports, and the todos they propose", async () => {
		const merged = await skillExample("## ✅ Merged");
		const removed = await skillExample("## 🛑 Removed");

		// `[#<id>]` is a placeholder, not a number: only a real id makes a card.
		expect(stretches(merged).map((each) => each.type)).toEqual([
			"report",
			"text",
		]);
		expect(stretches(merged)[0]).toEqual({
			type: "report",
			report: {
				ending: "merged",
				task: "<task>",
				base: "<base>",
				to: null,
				reason: null,
				body: "One sentence on what changed.\n\n- Restart `arbor dev` to see it.",
				source:
					"## ✅ Merged <task> onto <base>\n\nOne sentence on what changed.\n\n- Restart `arbor dev` to see it.",
			},
		});
		expect(stretches(removed)[0]).toEqual({
			type: "report",
			report: {
				ending: "removed",
				task: "<task>",
				base: null,
				to: null,
				reason: "superseded by a fix on main",
				body: "One sentence on what the task set out to do.",
				source:
					"## 🛑 Removed <task>: superseded by a fix on main\n\nOne sentence on what the task set out to do.",
			},
		});
	});

	it("reads an old handoff report, naming the agent the task went to", () => {
		const example =
			"## 🤝 Handed off <task> to Codex: you asked for GPT-5.5 on the styles\n\nThe parser and its tests are done; the card's styles are next.";

		expect(stretches(example)).toEqual([
			{
				type: "report",
				report: {
					ending: "handed",
					task: "<task>",
					base: null,
					to: "Codex",
					reason: "you asked for GPT-5.5 on the styles",
					body: "The parser and its tests are done; the card's styles are next.",
					source:
						"## 🤝 Handed off <task> to Codex: you asked for GPT-5.5 on the styles\n\nThe parser and its tests are done; the card's styles are next.",
				},
			},
		]);
	});

	it("reads a handoff with no reason, to an agent named with its model", () => {
		const [stretch] = stretches(
			"## 🤝 Handed off login to Claude (Opus)\n\nThe tests are next.",
		);

		expect(stretch).toMatchObject({
			type: "report",
			report: {
				ending: "handed",
				task: "login",
				to: "Claude (Opus)",
				reason: null,
				body: "The tests are next.",
			},
		});
	});

	it("reads the skill's working report on a task handed on, naming the agent after the colon", async () => {
		const example = await skillExample("## ⏳ Working <task>");

		expect(stretches(example)).toEqual([
			{
				type: "report",
				report: {
					ending: "working",
					task: "<task>",
					base: null,
					to: null,
					reason: "on Claude Sonnet 5.5",
					body: "Forty files still need the same rename, each listed under `## Next`, so a cheaper model takes them.",
					source: example,
				},
			},
		]);
		expect(stretches("## ⏳ Working lanes-fix\n\nOut.")[0]).toMatchObject({
			report: { ending: "working", task: "lanes-fix", reason: null },
		});
	});

	it("reads the skill's finished lanes report, naming each lane", async () => {
		const example = await skillExample("## 🏁 Finished lanes");

		expect(stretches(example)).toEqual([
			{
				type: "report",
				report: {
					ending: "finished",
					lanes: ["Stats", "Licensing"],
					reason: null,
					body: expect.stringContaining("- Stats: #155 merged"),
					source: example,
				},
			},
		]);
		expect(stretches("## 🏁 Finished lane Stats\n\nIt leads.")[0]).toEqual({
			type: "report",
			report: {
				ending: "finished",
				lanes: ["Stats"],
				reason: null,
				body: "It leads.",
				source: "## 🏁 Finished lane Stats\n\nIt leads.",
			},
		});
	});

	it("reads the skill's working lanes report, naming each lane and the tasks out", async () => {
		const example = await skillExample("## ⏳ Working lanes");

		expect(stretches(example)).toEqual([
			{
				type: "report",
				report: {
					ending: "working",
					lanes: ["Stats", "Licensing"],
					reason: "on stats-breakdowns-clear, licensing-renew",
					body: expect.stringContaining("- Stats: #155 out"),
					source: example,
				},
			},
		]);
	});

	it("reads the skill's waiting lanes report, naming each lane and what they wait on, then the questions it relays", async () => {
		const example = await skillExample("## ⏸️ Waiting lanes");

		expect(stretches(example)).toEqual([
			{
				type: "report",
				report: {
					ending: "waiting",
					lanes: ["Stats"],
					reason: "on stats-breakdowns-clear",
					body: expect.stringContaining(
						"- Stats: waits on stats-breakdowns-clear",
					),
					source: example.slice(0, example.indexOf("\n\n1. ")),
				},
			},
			{
				type: "questions",
				questions: [
					expect.objectContaining({
						text: "Which breakdown should lead the table?",
					}),
				],
			},
		]);
		expect(stretches("## ⏸ Waiting lane Stats\n\nIt waits.")[0]).toEqual({
			type: "report",
			report: {
				ending: "waiting",
				lanes: ["Stats"],
				reason: null,
				body: "It waits.",
				source: "## ⏸ Waiting lane Stats\n\nIt waits.",
			},
		});
	});

	it("reads the skill's word that an orchestrator started lanes, what they add up to under it", async () => {
		const example = await skillExample("## 🌱 Started lanes");

		expect(stretches(example)).toEqual([
			{
				type: "start",
				start: {
					lanes: ["Stats", "Licensing"],
					goal: "Make the Stats page say what to act on, then renew licenses on their own.",
				},
			},
		]);
	});

	it("leaves a title saying a task was added as words, since arbor draws that itself", () => {
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

	it("reads a proposed todo anywhere in a message, up to the next heading or questions", () => {
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

	it("reads a reply's `- Assumed <number>:` lines as the calls assumed, out of the list and report they end", () => {
		const found = stretches(
			[
				"## ⚠️ Escalated uploads: needs a call on retries",
				"",
				"An upload the server refuses as too big now stops.",
				"",
				"- Restart `arbor dev` to see it.",
				"- Assumed 3: Three tries, a second apart",
				"",
				"- Assumed 4: Kept the old endpoint for a release",
				"",
				"1. Should a 429 retry?",
				"",
				"- Assumed: an orchestrator's lane name, which no number makes a call",
			].join("\n"),
		);

		expect(found).toEqual([
			expect.objectContaining({
				type: "report",
				report: expect.objectContaining({
					ending: "escalated",
					body: "An upload the server refuses as too big now stops.\n\n- Restart `arbor dev` to see it.",
				}),
			}),
			{
				type: "assumed",
				assumed: [
					{ number: "3", text: "Three tries, a second apart" },
					{ number: "4", text: "Kept the old endpoint for a release" },
				],
			},
			expect.objectContaining({ type: "questions" }),
			{
				type: "text",
				text: "- Assumed: an orchestrator's lane name, which no number makes a call",
			},
		]);
	});

	it("gives the calls an exhibit captions what it shows, up to a blank line", () => {
		const found = stretches(
			[
				"The header wraps now.",
				"",
				"- Assumed 4: Named it `Header`",
				"",
				"### 🖼️ The header at 390px",
				"",
				"![header at 390px](/abs/header.png)",
				"",
				"- Assumed 5: The nav collapses into a menu below 480px",
				"- Assumed 6: The search box moves into the menu too",
				"",
				"- Assumed 7: Kept the old breakpoints elsewhere",
			].join("\n"),
		);

		const exhibit = {
			title: "The header at 390px",
			body: "![header at 390px](/abs/header.png)",
		};
		expect(found).toEqual([
			{ type: "text", text: "The header wraps now." },
			{
				type: "assumed",
				assumed: [
					{ number: "4", text: "Named it `Header`" },
					{
						number: "5",
						text: "The nav collapses into a menu below 480px",
						exhibit,
					},
					{
						number: "6",
						text: "The search box moves into the menu too",
						exhibit,
					},
					{ number: "7", text: "Kept the old breakpoints elsewhere" },
				],
			},
		]);
	});

	it("leaves an exhibit that captions no call as text", () => {
		const text = [
			"### 🖼️ The header at 390px",
			"",
			"![header at 390px](/abs/header.png)",
		].join("\n");

		expect(stretches(text)).toEqual([{ type: "text", text }]);
	});

	it("ends a proposed todo at its paragraph, leaving the message after it as text", () => {
		const found = stretches(
			[
				"### 📝 Install scry from npm [#162]",
				"",
				"No open todo relates to this lane,",
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
					body: "No open todo relates to this lane,\nand this one is at the top of the list.",
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
					to: null,
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
 * The report examples the arbor skill shows agents, as agents copy them,
 * from its SKILL.md and every reference file alike.
 */
async function skillExamples(): Promise<string[]> {
	const dir = join(import.meta.dir, "../../skills/arbor");
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
