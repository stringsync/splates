import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { add } from "./add";
import { inbox, openQuestions } from "./inbox";
import { PLAN_FILE } from "./plan";
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
			"- [x] Q1. [ui] Run it. → pass",
			"- [ ] Q2. [ui, db] Open /tmp/a.png. Does it fit? → pass",
			"- [ ] Q3. Decide: keep or drop?",
		);
		await ask(
			deps,
			"beta",
			"- [ ] Q1. [db] Run the migration when?",
			"  - (a) now",
			"  - (b) after the backfill",
		);
		deps.log.clear();
	});

	afterEach(() => deps.disposeAsync());

	it("gathers every open question across tasks, with tag counts", async () => {
		const found = await openQuestions(deps);

		expect(
			found.questions.map(({ task, number, reply }) => ({
				task,
				number,
				reply,
			})),
		).toEqual([
			{ task: "alpha", number: "Q2", reply: "pass" },
			{ task: "alpha", number: "Q3", reply: null },
			{ task: "beta", number: "Q1", reply: null },
		]);
		expect(found.questions[0]).toMatchObject({
			status: "working",
			lease: "none",
			tags: ["ui", "db"],
			text: "Open /tmp/a.png. Does it fit?",
		});
		// The checked-off Q1 is not counted: nobody has to answer it.
		expect(found.tags).toEqual([
			{ tag: "db", count: 2 },
			{ tag: "ui", count: 1 },
		]);
	});

	it("keeps the questions carrying any of the tags asked for", async () => {
		const found = await openQuestions(deps, { tags: ["ui", "nope"] });

		expect(found.questions.map((question) => question.number)).toEqual(["Q2"]);
		expect(found.tags).toHaveLength(2); // the whole inbox, to pick another slice
	});

	it("prints them grouped by task, the tags first", async () => {
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
				"db 2  ui 1",
				"",
				"alpha",
				"  Q2 [ui, db] Open /tmp/a.png. Does it fit?",
				"    → pass",
				"  Q3 Decide: keep or drop?",
				"",
				"beta (in a live session: answer it there)",
				"  Q1 [db] Run the migration when?",
				"      (a) now",
				"      (b) after the backfill",
			].join("\n"),
		);

		deps.log.clear();
		await inbox(deps, { json: true });
		expect(JSON.parse(deps.out()).questions).toHaveLength(3);
	});

	it("says so plainly when nothing is waiting", async () => {
		await inbox(deps, { tags: ["css"] });
		expect(deps.out()).toBe("no open questions tagged css");

		await ask(deps, "alpha");
		await ask(deps, "beta");
		deps.log.clear();
		await inbox(deps);
		expect(deps.out()).toBe("no open questions");
	});
});
