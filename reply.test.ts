import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { add } from "./add";
import { PLAN_FILE, questions } from "./plan";
import { remove } from "./remove";
import {
	claimReplies,
	defer,
	holdReply,
	readReplies,
	releaseReply,
	replyTo,
	withdrawReply,
} from "./reply";
import { LIVE_PID, Testing } from "./testing";

const PLAN = `# alpha

## Goal

x

## Blocked

- [x] Q1. Run it. → pass
- [ ] Q2. Open /tmp/a.png. Does it fit? → no
- [ ] Q3. Decide: keep or drop?
`;

describe("reply", () => {
	let deps: Testing;
	let plan: string;

	beforeEach(async () => {
		deps = await Testing.open();
		await add(deps, "alpha");
		// `add` leased it to this process, which is still alive.
		const worktree = await (await deps.service.find("alpha")).save({
			lease: null,
		});
		plan = join(worktree.path, PLAN_FILE);
		await deps.fs.write(plan, PLAN);
		deps.log.clear();
	});

	afterEach(() => deps.disposeAsync());

	it("waits outside the plan until its agent claims it", async () => {
		await replyTo(deps, "alpha", "q3", { text: "keep" });

		expect(await deps.fs.read(plan)).toBe(PLAN);

		const claimed = await claimReplies(deps, "alpha");

		expect(claimed.claimed.map((asked) => asked.number)).toEqual(["Q3"]);
		expect(claimed.unanswered).toEqual([]);
		expect(await deps.fs.read(plan)).toBe(
			PLAN.replace("keep or drop?", "keep or drop? → keep"),
		);
		expect(await deps.replies.find("alpha", "Q3")).toBeNull();
	});

	it("replaces a reply its agent has not claimed yet", async () => {
		await replyTo(deps, "alpha", "Q3", { text: "keep" });
		const replied = await replyTo(deps, "alpha", "3", { text: "drop" });

		expect(replied.question).toMatchObject({ number: "Q3", reply: null });
		expect(replied.reply).toMatchObject({ text: "drop", editingUntil: null });
		expect(await deps.replies.forTask("alpha")).toHaveLength(1);
	});

	it("follows up an answer its agent has read, reopening the question", async () => {
		await deps.fs.write(
			plan,
			`${PLAN}- [x] Q4. Which table? → users\n  It is the big one.\n\n## Notes\n`,
		);

		await replyTo(deps, "alpha", "Q2", { text: "shrink it" });
		await replyTo(deps, "alpha", "Q4", { text: "and sessions" });
		const { claimed } = await claimReplies(deps, "alpha");

		expect(claimed.map((asked) => asked.number)).toEqual(["Q2", "Q4"]);
		expect(await deps.fs.read(plan)).toBe(
			`${PLAN.replace("Does it fit? → no", "Does it fit? → no\n  → shrink it")}- [ ] Q4. Which table? → users\n  It is the big one.\n  → and sessions\n\n## Notes\n`,
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

	it("stores files of any kind beside the reply and names them once claimed", async () => {
		const bytes = new Uint8Array([1, 2, 3]);
		const replied = await replyTo(deps, "alpha", "Q3", {
			text: "see",
			files: [
				{ name: "my shot.png", bytes },
				{ name: "trace.log", bytes },
			],
		});

		const dir = `${deps.service.repliesPath("alpha")}/Q3`;
		expect(replied.reply.files).toEqual([
			`${dir}/0-my-shot.png`,
			`${dir}/1-trace.log`,
		]);
		expect(await deps.fs.readBytes(`${dir}/0-my-shot.png`)).toEqual(bytes);

		// Claiming keeps the files: the plan names them.
		await claimReplies(deps, "alpha");
		const [, , asked] = questions(await deps.fs.read(plan));
		expect(asked?.reply).toBe(`see ${replied.reply.files.join(" ")}`);
		expect(await deps.fs.exists(`${dir}/1-trace.log`)).toBe(true);

		// Gone with the task, so nothing outlives what it was attached to.
		await remove(deps, "alpha");
		expect(await deps.fs.exists(dir)).toBe(false);
	});

	it("keeps the files asked for when a reply changes, and drops the rest", async () => {
		const first = await replyTo(deps, "alpha", "Q3", {
			text: "see",
			files: [
				{ name: "a.png", bytes: new Uint8Array([1]) },
				{ name: "b.png", bytes: new Uint8Array([2]) },
			],
		});
		const [kept = "", dropped = ""] = first.reply.files;

		const second = await replyTo(deps, "alpha", "Q3", {
			text: "see",
			keep: [kept],
			files: [{ name: "c.png", bytes: new Uint8Array([3]) }],
		});

		expect(second.reply.files).toEqual([
			kept,
			`${deps.service.repliesPath("alpha")}/Q3/2-c.png`,
		]);
		expect(await deps.fs.exists(dropped)).toBe(false);
	});

	it("picks a choice, with or without words", async () => {
		const offered = `${PLAN}- [ ] Q4. Where does it live?\n  - (a) sessions\n  - (b) users\n`;
		await deps.fs.write(plan, offered);

		const picked = await replyTo(deps, "alpha", "Q4", {
			text: "",
			choices: ["b"],
		});
		expect(picked.reply.choices).toEqual(["b"]);

		await replyTo(deps, "alpha", "Q4", {
			text: "and backfill",
			choices: ["a"],
		});
		await claimReplies(deps, "alpha");
		expect(await deps.fs.read(plan)).toBe(
			offered.replace("live?", "live? → a (sessions): and backfill"),
		);
	});

	it("refuses a choice the question doesn't offer", async () => {
		await deps.fs.write(
			plan,
			`${PLAN}- [ ] Q4. Where?\n  - (a) sessions\n  - (b) users\n`,
		);

		await expect(
			replyTo(deps, "alpha", "Q4", { text: "", choices: ["c"] }),
		).toBail("usage", { message: "Q4 offers a, b, not 'c'" });
		await expect(
			replyTo(deps, "alpha", "Q3", { text: "", choices: ["a"] }),
		).toBail("usage", { message: "Q3 offers no choices" });
		await expect(
			replyTo(deps, "alpha", "Q4", { text: "", choices: ["a", "b"] }),
		).toBail("usage", { message: "Q4 takes one choice at most" });
	});

	it("picks any that apply from a [a] list", async () => {
		await deps.fs.write(
			plan,
			`${PLAN}- [ ] Q4. Notify where?\n  - [a] Email\n  - [b] Slack\n  - [c] Push\n`,
		);

		await replyTo(deps, "alpha", "Q4", {
			text: "and log it",
			choices: ["c", "a"],
		});
		const { claimed } = await claimReplies(deps, "alpha");

		expect(claimed[0]).toMatchObject({
			reply: "a (Email), c (Push): and log it",
			chosen: ["a", "c"],
		});
	});

	it("takes a reply back, files and all, before its agent claims it", async () => {
		const replied = await replyTo(deps, "alpha", "Q3", {
			text: "keep",
			files: [{ name: "shot.png", bytes: new Uint8Array([1]) }],
		});
		const [file] = replied.reply.files;

		const withdrawn = await withdrawReply(deps, "alpha", "q3");

		expect(withdrawn.reply.text).toBe("keep");
		expect(await deps.replies.find("alpha", "Q3")).toBeNull();
		expect(await deps.fs.exists(file ?? "")).toBe(false);
	});

	it("refuses to take back what is not there or already read", async () => {
		await expect(withdrawReply(deps, "alpha", "Q3")).toBail("not_found", {
			message: "no reply to withdraw",
		});
		await replyTo(deps, "alpha", "Q3", { text: "keep" });
		await claimReplies(deps, "alpha");
		await expect(withdrawReply(deps, "alpha", "Q3")).toBail("not_found");
		await expect(holdReply(deps, "alpha", "Q3")).toBail("not_found");
	});

	it("defers a question to a todo, images and all, and tells its agent so", async () => {
		const shot = join(deps.root, "shot.png");
		await deps.fs.writeBytes(shot, new Uint8Array([7]));
		await deps.fs.write(
			plan,
			`${PLAN}- [ ] Q4. Tidy the header?\n  ![header](${shot})\n`,
		);

		await defer(deps, "alpha", "Q4");

		const [todo] = await deps.todos.all();
		expect(todo?.state).toMatchObject({
			id: 1,
			from: "alpha",
			text: `Tidy the header?\n\n![header](${shot})`,
		});
		expect(await deps.fs.readBytes(todo?.state.files[0] ?? "")).toEqual(
			new Uint8Array([7]),
		);
		expect((await deps.replies.find("alpha", "Q4"))?.state.text).toBe(
			"Deferred to todo 1: leave it out of this task.",
		);
	});

	it("keeps a reply someone is editing from its agent until they let go", async () => {
		await replyTo(deps, "alpha", "Q3", { text: "keep" });
		const held = await holdReply(deps, "alpha", "Q3");
		expect(held.reply.editingUntil).not.toBeNull();

		const blocked = await claimReplies(deps, "alpha");
		expect(blocked).toMatchObject({ claimed: [], editing: ["Q3"] });
		expect(await deps.fs.read(plan)).toBe(PLAN);

		await releaseReply(deps, "alpha", "Q3");
		expect((await claimReplies(deps, "alpha")).claimed).toHaveLength(1);
	});

	it("lets a hold lapse on its own", async () => {
		await replyTo(deps, "alpha", "Q3", { text: "keep" });
		const pending = await deps.replies.find("alpha", "Q3");
		await deps.replies.save({
			...(pending?.state ?? ({} as never)),
			editingUntil: new Date(Date.now() - 1000).toISOString(),
		});

		expect((await claimReplies(deps, "alpha")).claimed).toHaveLength(1);
	});

	it("prints what it claimed and what still waits", async () => {
		await deps.fs.write(plan, `${PLAN}- [ ] Q4. And this?\n`);
		await replyTo(deps, "alpha", "Q3", { text: "keep" });

		await readReplies(deps, "alpha");

		expect(deps.out()).toBe(
			[
				"alpha replied",
				"  Q3 Decide: keep or drop?",
				"    → keep",
				"  unanswered: Q4",
			].join("\n"),
		);

		deps.log.clear();
		await readReplies(deps, "alpha");
		expect(deps.out()).toBe(
			["alpha has no new replies", "  unanswered: Q4"].join("\n"),
		);
	});

	it("refuses a task whose agent is in a live session", async () => {
		await (await deps.service.find("alpha")).save({
			lease: {
				pid: LIVE_PID,
				hostname: deps.ps.hostname,
				heartbeatAt: new Date().toISOString(),
			},
		});

		await expect(replyTo(deps, "alpha", "Q3", { text: "keep" })).toBail(
			"lease_held",
			{ message: "answer it in that chat" },
		);
		expect(await deps.replies.forTask("alpha")).toEqual([]);
	});

	it("refuses an unknown task or question", async () => {
		await expect(replyTo(deps, "nope", "Q1", { text: "x" })).toBail(
			"not_found",
		);
		await expect(replyTo(deps, "alpha", "Q9", { text: "x" })).toBail(
			"not_found",
			{ data: { task: "alpha", question: "Q9" } },
		);
		await expect(replyTo(deps, "alpha", "D1", { text: "x" })).toBail("usage");
		await expect(replyTo(deps, "alpha", "Q3", { text: " " })).toBail("usage");
	});
});
