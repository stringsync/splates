import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { add } from "./add";
import { inbox, openQuestions } from "./inbox";
import { PLAN_FILE } from "./plan";
import { holdReply, replyTo } from "./reply";
import { LIVE_PID, Testing } from "./testing";

/**
 * Gives a task a plan whose `## Blocked` holds these items, and drops the
 * lease `add` took: this process is still alive, so it would read as held.
 */
async function ask(deps: Testing, task: string, ...items: string[]) {
	const worktree = (await (await deps.service.find(task)).save({ lease: null }))
		.path;
	await deps.fs.write(
		`${worktree}/${PLAN_FILE}`,
		`# ${task}\n\n## Goal\n\nx\n\n## Blocked\n\n${items.join("\n")}\n`,
	);
}

describe("inbox", () => {
	let deps: Testing;

	beforeEach(async () => {
		deps = await Testing.open();
		await add(deps, "alpha");
		await add(deps, "beta");
		await add(deps, "gamma");
		await ask(
			deps,
			"alpha",
			"- [x] Q1. Run it. → yes",
			"- [ ] Q2. Open /tmp/a.png. Does it fit? → yes",
			"- [ ] Q3. 🧹 Keep or drop the old flag?",
			"  It has been off since March.",
		);
		await ask(
			deps,
			"beta",
			"- [ ] Q1. 🗄️ Run the migration when?",
			"  - (a) now",
			"  - (b) after the backfill",
			"- [ ] Q2. 🔔 Notify where?",
			"  - [a] Email",
			"  - [b] Slack",
		);
		deps.log.clear();
	});

	afterEach(() => deps.disposeAsync());

	it("gathers the questions still waiting on a reply, across tasks", async () => {
		const found = await openQuestions(deps);

		expect(
			found.questions.map(({ task, number }) => `${task} ${number}`),
		).toEqual(["alpha Q3", "beta Q1", "beta Q2"]);
		expect(found.questions[0]).toMatchObject({
			status: "working",
			lease: "none",
			text: "🧹 Keep or drop the old flag?",
			body: "It has been off since March.",
		});
		// Answered, so it waits on its agent now; the checked-off Q1 on nobody.
		expect(found.replied).toBe(1);
	});

	it("keeps the replied ones too when asked, to change an answer", async () => {
		const found = await openQuestions(deps, { replied: true });

		expect(found.questions.map((question) => question.number)).toEqual([
			"Q2",
			"Q3",
			"Q1",
			"Q2",
		]);
		expect(found.questions[0]?.reply).toBe("yes");
	});

	it("moves a question with a reply waiting to be claimed to replied", async () => {
		await replyTo(deps, "alpha", "Q3", { text: "keep" });

		const open = await openQuestions(deps);
		expect(
			open.questions.map(({ task, number }) => `${task} ${number}`),
		).toEqual(["beta Q1", "beta Q2"]);
		expect(open.replied).toBe(2);

		const all = await openQuestions(deps, { replied: true });
		const states = all.questions.map(
			({ task, number, state }) => `${task} ${number} ${state}`,
		);
		expect(states).toEqual([
			"alpha Q2 read",
			"alpha Q3 replied",
			"beta Q1 open",
			"beta Q2 open",
		]);
		expect(all.questions[1]?.pending?.text).toBe("keep");

		await holdReply(deps, "alpha", "Q3");
		const held = await openQuestions(deps, { replied: true });
		expect(held.questions[1]?.state).toBe("editing");

		deps.log.clear();
		await inbox(deps, { replied: true });
		expect(deps.out()).toContain("    → keep (waiting for its agent)");
	});

	it("prints them grouped by task, bodies and choices under them", async () => {
		await (await deps.service.find("beta")).save({
			lease: {
				pid: LIVE_PID,
				hostname: deps.ps.hostname,
				heartbeatAt: new Date().toISOString(),
			},
		});

		await inbox(deps);

		expect(deps.out()).toBe(
			[
				"alpha",
				"  Q3 🧹 Keep or drop the old flag?",
				"      It has been off since March.",
				"",
				"beta (in a live session: answer it there)",
				"  Q1 🗄️ Run the migration when?",
				"      (a) now",
				"      (b) after the backfill",
				"  Q2 🔔 Notify where?",
				"      [a] Email",
				"      [b] Slack",
				"",
				"1 replied, not yet acted on: arbor inbox --replied",
			].join("\n"),
		);

		deps.log.clear();
		await inbox(deps, { replied: true });
		expect(deps.out()).toContain(
			"  Q2 Open /tmp/a.png. Does it fit?\n    → yes",
		);
		expect(deps.out()).not.toContain("--replied");

		deps.log.clear();
		await inbox(deps, { json: true });
		expect(JSON.parse(deps.out()).questions).toHaveLength(3);
	});

	it("says so plainly when nothing is waiting", async () => {
		await ask(deps, "beta");
		await ask(deps, "alpha", "- [ ] Q2. Does it fit? → yes");
		deps.log.clear();
		await inbox(deps);
		expect(deps.out()).toBe(
			"nothing needs you\n1 replied, not yet acted on: arbor inbox --replied",
		);

		await ask(deps, "alpha");
		deps.log.clear();
		await inbox(deps);
		expect(deps.out()).toBe("nothing needs you");
	});
});
