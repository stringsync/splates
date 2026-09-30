import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { add } from "./add";
import { PLAN_FILE, messages as planMessages, questions } from "./plan";
import { remove } from "./remove";
import {
	claim,
	hold,
	readMessages,
	release,
	replyTo,
	sendMessage,
	sentList,
	withdraw,
} from "./send";
import { LIVE_PID, Testing } from "./testing";

const PLAN = `# alpha

## Goal

x

## Blocked

- [x] Q1. Run it. → pass
- [ ] Q2. Open /tmp/a.png. Does it fit? → no
- [ ] Q3. Decide: keep or drop?
`;

describe("send", () => {
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

	/** Puts the task's agent in a live session. */
	const live = async () =>
		(await deps.service.find("alpha")).save({
			lease: {
				pid: LIVE_PID,
				hostname: deps.ps.hostname,
				heartbeatAt: new Date().toISOString(),
			},
		});

	describe("a reply", () => {
		it("waits outside the plan until its agent claims it", async () => {
			const replied = await replyTo(deps, "alpha", "q3", { text: "keep" });

			expect(replied).toMatchObject({
				id: "Q3",
				text: "keep",
				claimedAt: null,
			});
			expect(await deps.fs.read(plan)).toBe(PLAN);

			const claimed = await claim(deps, "alpha");

			expect(claimed.replies.map((asked) => asked.number)).toEqual(["Q3"]);
			expect(claimed.unanswered).toEqual([]);
			expect(await deps.fs.read(plan)).toBe(
				PLAN.replace("keep or drop?", "keep or drop? → keep"),
			);
			// Kept, marked read, for the page to list among what was sent.
			expect((await deps.messages.find("alpha", "Q3"))?.claimed).toBe(true);
			expect((await claim(deps, "alpha")).replies).toEqual([]);
		});

		it("replaces one its agent has not claimed yet", async () => {
			await replyTo(deps, "alpha", "Q3", { text: "keep" });
			const replied = await replyTo(deps, "alpha", "3", { text: "drop" });

			expect(replied.text).toBe("drop");
			expect(await deps.messages.forTask("alpha")).toHaveLength(1);
		});

		it("can no longer change once read", async () => {
			await expect(replyTo(deps, "alpha", "Q2", { text: "yes" })).toBail(
				"exists",
				{ message: "follow it up with a message" },
			);

			await replyTo(deps, "alpha", "Q3", { text: "keep" });
			await claim(deps, "alpha");
			await expect(replyTo(deps, "alpha", "Q3", { text: "drop" })).toBail(
				"exists",
			);
			await expect(hold(deps, "alpha", "Q3")).toBail("exists");
			await expect(withdraw(deps, "alpha", "Q3")).toBail("exists");
		});

		it("stores files beside it and names them once claimed", async () => {
			const bytes = new Uint8Array([1, 2, 3]);
			const replied = await replyTo(deps, "alpha", "Q3", {
				text: "see",
				files: [
					{ name: "my shot.png", bytes },
					{ name: "trace.log", bytes },
				],
			});

			const dir = `${deps.service.messagesPath("alpha")}/Q3`;
			expect(replied.files).toEqual([
				`${dir}/0-my-shot.png`,
				`${dir}/1-trace.log`,
			]);
			expect(await deps.fs.readBytes(`${dir}/0-my-shot.png`)).toEqual(bytes);

			await claim(deps, "alpha");
			const [, , asked] = questions(await deps.fs.read(plan));
			expect(asked?.reply).toBe(`see ${replied.files.join(" ")}`);

			// Gone with the task, so nothing outlives what it was attached to.
			await remove(deps, "alpha");
			expect(await deps.fs.exists(dir)).toBe(false);
		});

		it("keeps the files asked for when it changes, and drops the rest", async () => {
			const first = await replyTo(deps, "alpha", "Q3", {
				text: "see",
				files: [
					{ name: "a.png", bytes: new Uint8Array([1]) },
					{ name: "b.png", bytes: new Uint8Array([2]) },
				],
			});
			const [kept = "", dropped = ""] = first.files;

			const second = await replyTo(deps, "alpha", "Q3", {
				text: "see",
				keep: [kept],
				files: [{ name: "c.png", bytes: new Uint8Array([3]) }],
			});

			expect(second.files).toEqual([
				kept,
				`${deps.service.messagesPath("alpha")}/Q3/2-c.png`,
			]);
			expect(await deps.fs.exists(dropped)).toBe(false);
		});

		it("picks choices, spelled out in the plan", async () => {
			await deps.fs.write(
				plan,
				`${PLAN}- [ ] Q4. Notify where?\n  - [a] Email\n  - [b] Slack\n  - [c] Push\n- [ ] Q5. Where?\n  - (a) sessions\n  - (b) users\n`,
			);

			await replyTo(deps, "alpha", "Q4", {
				text: "and log it",
				choices: ["c", "a"],
			});
			await replyTo(deps, "alpha", "Q5", { text: "", choices: ["b"] });
			const { replies } = await claim(deps, "alpha");

			expect(replies.map((asked) => asked.reply)).toEqual([
				"a (Email), c (Push): and log it",
				"b (users)",
			]);
			await expect(
				replyTo(deps, "alpha", "Q5", { text: "", choices: ["c"] }),
			).toBail("exists");
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

		it("refuses a task whose agent is in a live session", async () => {
			await live();

			await expect(replyTo(deps, "alpha", "Q3", { text: "keep" })).toBail(
				"lease_held",
				{ message: "answer it in that chat" },
			);
		});

		it("refuses an unknown task or question", async () => {
			await expect(replyTo(deps, "nope", "Q1", { text: "x" })).toBail(
				"not_found",
			);
			await expect(replyTo(deps, "alpha", "Q9", { text: "x" })).toBail(
				"not_found",
				{ data: { task: "alpha", question: "Q9" } },
			);
			await expect(replyTo(deps, "alpha", "Q1", { text: "x" })).toBail(
				"not_found",
				{ message: "checked off already" },
			);
			await expect(replyTo(deps, "alpha", "D1", { text: "x" })).toBail("usage");
			await expect(replyTo(deps, "alpha", "Q3", { text: " " })).toBail("usage");
		});
	});

	describe("a message", () => {
		it("goes under ## Messages once claimed, numbered after any there", async () => {
			await deps.fs.write(
				plan,
				`${PLAN}\n## Messages\n\n- [x] M1. Use the staging db.\n`,
			);

			const sent = await sendMessage(deps, "alpha", {
				text: "Keep the flag.\nBehind an env var.",
				files: [{ name: "notes.md", bytes: new Uint8Array([1]) }],
			});

			expect(sent).toMatchObject({ id: "M2", about: null });
			const claimed = await claim(deps, "alpha");
			expect(claimed.messages.map((found) => found.id)).toEqual(["M2"]);
			expect(await deps.fs.read(plan)).toContain(
				[
					"- [x] M1. Use the staging db.",
					"- [ ] M2. Keep the flag.",
					"  Behind an env var.",
					`  ${sent.files[0]}`,
				].join("\n"),
			);
		});

		it("makes the section when the plan has none", async () => {
			await sendMessage(deps, "alpha", { text: "Rename it." });
			await claim(deps, "alpha");

			const text = await deps.fs.read(plan);
			expect(text.endsWith("\n## Messages\n\n- [ ] M1. Rename it.\n")).toBe(
				true,
			);
			expect(planMessages(text)).toEqual([
				{ id: "M1", done: false, text: "Rename it." },
			]);
		});

		it("follows up a reply already read", async () => {
			await replyTo(deps, "alpha", "Q3", { text: "keep" });
			await claim(deps, "alpha");

			await sendMessage(deps, "alpha", {
				about: "q3",
				text: "Actually, drop it.",
			});
			await sendMessage(deps, "alpha", {
				about: "m1",
				text: "And delete the tests.",
			});
			const { messages } = await claim(deps, "alpha");

			expect(messages.map((found) => found.text)).toEqual([
				"Re Q3: Actually, drop it.",
				"Re M1: And delete the tests.",
			]);
		});

		it("changes, or is withdrawn, until claimed", async () => {
			const first = await sendMessage(deps, "alpha", { text: "Rename it." });
			const changed = await sendMessage(deps, "alpha", {
				id: first.id,
				text: "Rename it to arbor.",
			});

			expect(changed).toMatchObject({ id: "M1", text: "Rename it to arbor." });
			await withdraw(deps, "alpha", "M1");
			expect(await deps.messages.forTask("alpha")).toEqual([]);
			await expect(withdraw(deps, "alpha", "M1")).toBail("not_found");

			await sendMessage(deps, "alpha", { text: "Rename it." });
			await claim(deps, "alpha");
			await expect(sendMessage(deps, "alpha", { id: "M1", text: "x" })).toBail(
				"exists",
			);
		});

		it("reaches an agent in a live session too", async () => {
			await live();

			expect(
				(await sendMessage(deps, "alpha", { text: "Stop there." })).id,
			).toBe("M1");
		});

		it("refuses nothing to say, or a task with no tree", async () => {
			await expect(sendMessage(deps, "alpha", { text: " " })).toBail("usage");
			await expect(sendMessage(deps, "nope", { text: "x" })).toBail(
				"not_found",
			);
		});
	});

	describe("claiming", () => {
		it("leaves what someone is editing until they let go", async () => {
			await replyTo(deps, "alpha", "Q3", { text: "keep" });
			await sendMessage(deps, "alpha", { text: "Rename it." });
			await hold(deps, "alpha", "M1");

			const blocked = await claim(deps, "alpha");
			expect(blocked.replies.map((asked) => asked.number)).toEqual(["Q3"]);
			expect(blocked).toMatchObject({ messages: [], editing: ["M1"] });

			await release(deps, "alpha", "M1");
			expect((await claim(deps, "alpha")).messages).toHaveLength(1);
		});

		it("lets a hold lapse on its own", async () => {
			const sent = await sendMessage(deps, "alpha", { text: "Rename it." });
			await deps.messages.save({
				...sent,
				editingUntil: new Date(Date.now() - 1000).toISOString(),
			});

			expect((await claim(deps, "alpha")).messages).toHaveLength(1);
		});

		it("prints what it claimed and what still waits", async () => {
			await deps.fs.write(plan, `${PLAN}- [ ] Q4. And this?\n`);
			await replyTo(deps, "alpha", "Q3", { text: "keep" });
			await sendMessage(deps, "alpha", { text: "Rename it." });

			await readMessages(deps, "alpha");

			expect(deps.out()).toBe(
				[
					"alpha has new",
					"  Q3 Decide: keep or drop?",
					"    → keep",
					"  M1 Rename it.",
					"  unanswered: Q4",
				].join("\n"),
			);

			deps.log.clear();
			await readMessages(deps, "alpha");
			expect(deps.out()).toBe(
				["alpha has nothing new", "  unanswered: Q4"].join("\n"),
			);
		});
	});

	it("lists everything sent, newest first, with where each stands", async () => {
		await replyTo(deps, "alpha", "Q3", { text: "keep" });
		await sendMessage(deps, "alpha", { text: "Rename it." });
		await claim(deps, "alpha");
		await sendMessage(deps, "alpha", {
			text: "\n",
			files: [{ name: "a.png", bytes: new Uint8Array([1]) }],
		});
		// The agent acts on the reply.
		await deps.fs.write(
			plan,
			(await deps.fs.read(plan)).replace("- [ ] Q3.", "- [x] Q3."),
		);

		const sent = await sentList(deps);

		expect(
			sent.map(({ message, subject, state }) => [message.id, subject, state]),
		).toEqual([
			["M2", "1 file", "waiting"],
			["M1", "Rename it.", "read"],
			["Q3", "Decide: keep or drop?", "done"],
		]);
	});
});
