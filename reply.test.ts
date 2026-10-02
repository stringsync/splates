import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { add } from "./add";
import { PLAN_FILE, questions } from "./plan";
import { remove } from "./remove";
import { defer, replyTo } from "./reply";
import { Testing } from "./testing";

const PLAN = `# alpha

## Goal

x

## Blocked

- [x] 1. Run it. → pass
- [ ] 2. Open /tmp/a.png. Does it fit? → no
- [ ] 3. Decide: keep or drop?
`;

describe("reply", () => {
	let deps: Testing;
	let plan: string;

	beforeEach(async () => {
		deps = await Testing.open();
		await add(deps, "alpha");
		// Only an escalated task's questions are answered here.
		const worktree = await (await deps.service.find("alpha")).save({
			status: "escalated",
			lease: null,
		});
		plan = join(worktree.path, PLAN_FILE);
		await deps.fs.write(plan, PLAN);
		deps.log.clear();
	});

	afterEach(() => deps.disposeAsync());

	it("writes the answer into the plan after its question", async () => {
		const replied = await replyTo(deps, "alpha", "3", { text: "keep" });

		expect(replied.question).toMatchObject({ number: "3", reply: "keep" });
		expect(await deps.fs.read(plan)).toBe(
			PLAN.replace("keep or drop?", "keep or drop? → keep"),
		);
	});

	it("follows up an answer, reopening the question", async () => {
		await deps.fs.write(
			plan,
			`${PLAN}- [x] 4. Which table? → users\n  It is the big one.\n\n## Notes\n`,
		);

		await replyTo(deps, "alpha", "2", { text: "shrink it" });
		await replyTo(deps, "alpha", "4", { text: "and sessions" });

		expect(await deps.fs.read(plan)).toBe(
			`${PLAN.replace("Does it fit? → no", "Does it fit? → no\n  → shrink it")}- [ ] 4. Which table? → users\n  It is the big one.\n  → and sessions\n\n## Notes\n`,
		);
		const asked = questions(await deps.fs.read(plan));
		expect(asked[3]).toMatchObject({
			done: false,
			reply: "users",
			body: "It is the big one.",
			followUps: ["and sessions"],
		});
		expect(asked[1]?.followUps).toEqual(["shrink it"]);
	});

	it("stores files of any kind and names them in the answer", async () => {
		const bytes = new Uint8Array([1, 2, 3]);
		await replyTo(deps, "alpha", "3", {
			text: "see",
			files: [
				{ name: "my shot.png", bytes },
				{ name: "trace.log", bytes },
			],
		});

		const dir = `${deps.service.repliesPath("alpha")}/3`;
		const [, , asked] = questions(await deps.fs.read(plan));
		expect(asked?.reply).toBe(`see ${dir}/0-my-shot.png ${dir}/1-trace.log`);
		expect(await deps.fs.readBytes(`${dir}/0-my-shot.png`)).toEqual(bytes);

		// Gone with the task, so nothing outlives what it was attached to.
		await remove(deps, "alpha");
		expect(await deps.fs.exists(dir)).toBe(false);
	});

	it("picks a choice, with or without words", async () => {
		const offered = `${PLAN}- [ ] 4. Where does it live?\n  - (a) sessions\n  - (b) users\n- [ ] 5. And this?\n  - (a) yes\n`;
		await deps.fs.write(plan, offered);

		await replyTo(deps, "alpha", "4", {
			text: "and backfill",
			choices: ["a"],
		});
		const picked = await replyTo(deps, "alpha", "5", {
			text: "",
			choices: ["a"],
		});

		expect(picked.question.chosen).toEqual(["a"]);
		expect(await deps.fs.read(plan)).toBe(
			offered
				.replace("live?", "live? → a (sessions): and backfill")
				.replace("this?", "this? → a (yes)"),
		);
	});

	it("refuses a choice the question doesn't offer", async () => {
		await deps.fs.write(
			plan,
			`${PLAN}- [ ] 4. Where?\n  - (a) sessions\n  - (b) users\n`,
		);

		await expect(
			replyTo(deps, "alpha", "4", { text: "", choices: ["c"] }),
		).toBail("usage", { message: "question 4 offers a, b, not 'c'" });
		await expect(
			replyTo(deps, "alpha", "3", { text: "", choices: ["a"] }),
		).toBail("usage", { message: "question 3 offers no choices" });
		await expect(
			replyTo(deps, "alpha", "4", { text: "", choices: ["a", "b"] }),
		).toBail("usage", { message: "question 4 takes one choice at most" });
	});

	it("picks any that apply from a [a] list", async () => {
		await deps.fs.write(
			plan,
			`${PLAN}- [ ] 4. Notify where?\n  - [a] Email\n  - [b] Slack\n  - [c] Push\n`,
		);

		const replied = await replyTo(deps, "alpha", "4", {
			text: "and log it",
			choices: ["c", "a"],
		});

		expect(replied.question).toMatchObject({
			reply: "a (Email), c (Push): and log it",
			chosen: ["a", "c"],
		});
	});

	it("defers a question to a todo, images and all, and tells its agent so", async () => {
		const shot = join(deps.root, "shot.png");
		await deps.fs.writeBytes(shot, new Uint8Array([7]));
		await deps.fs.write(
			plan,
			`${PLAN}- [ ] 4. Tidy the header?\n  ![header](${shot})\n`,
		);

		await defer(deps, "alpha", "4");

		const [todo] = await deps.todos.all();
		expect(todo?.state).toMatchObject({
			id: 1,
			from: "alpha",
			subject: "Tidy the header?",
			text: `![header](${shot})`,
		});
		expect(await deps.fs.readBytes(todo?.state.files[0] ?? "")).toEqual(
			new Uint8Array([7]),
		);
		expect(questions(await deps.fs.read(plan))[3]?.reply).toBe(
			"Deferred to todo 1: leave it out of this task.",
		);
	});

	it("refuses a task that is not escalated: its agent is in a chat", async () => {
		await (await deps.service.find("alpha")).save({ status: "working" });

		await expect(replyTo(deps, "alpha", "3", { text: "keep" })).toBail(
			"not_escalated",
			{ message: "say it in that chat" },
		);
		expect(await deps.fs.read(plan)).toBe(PLAN);
	});

	it("refuses an unknown task or question", async () => {
		await expect(replyTo(deps, "nope", "1", { text: "x" })).toBail("not_found");
		await expect(replyTo(deps, "alpha", "9", { text: "x" })).toBail(
			"not_found",
			{ data: { task: "alpha", question: "9" } },
		);
		await expect(replyTo(deps, "alpha", "D1", { text: "x" })).toBail("usage");
		await expect(replyTo(deps, "alpha", "3", { text: " " })).toBail("usage");
	});
});
