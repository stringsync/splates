import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { CounterIdProvider } from "webappwiz/id";
import { add } from "./add";
import { PLAN_FILE, questions } from "./plan";
import { remove } from "./remove";
import { reply, replyTo } from "./reply";
import { LIVE_PID, Testing } from "./testing";

const PLAN = `# alpha

## Goal

x

## Blocked

- [x] Q1. Run it. → pass
- [ ] Q2. [ui] Open /tmp/a.png. Reply pass or fail. → fail
- [ ] Q3. Decide: keep or drop?
`;

describe("reply", () => {
	let deps: Testing & { ids: CounterIdProvider };
	let plan: string;

	beforeEach(async () => {
		deps = Object.assign(await Testing.open(), {
			ids: new CounterIdProvider(),
		});
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

	it("writes the answer onto the question's line, leaving it open", async () => {
		await reply(deps, "alpha", "q3", "keep");

		expect(await deps.fs.read(plan)).toBe(
			PLAN.replace("keep or drop?", "keep or drop? → keep"),
		);
		expect(deps.out()).toBe(
			["replied alpha", "  Q3 Decide: keep or drop?", "    → keep"].join("\n"),
		);
	});

	it("replaces an earlier reply", async () => {
		const replied = await replyTo(deps, "alpha", "2", { text: "pass" });

		expect(replied.question).toMatchObject({
			number: "Q2",
			done: false,
			tags: ["ui"],
			reply: "pass",
		});
		expect(await deps.fs.read(plan)).not.toContain("→ fail");
	});

	it("stores attachments with the task and names them in the reply", async () => {
		const bytes = new Uint8Array([1, 2, 3]);
		const replied = await replyTo(deps, "alpha", "Q3", {
			text: "see",
			images: [
				{ name: "my shot.png", bytes },
				{ name: "my shot.png", bytes },
			],
		});

		const dir = deps.service.attachmentsPath("alpha");
		expect(replied.attachments).toEqual([
			`${dir}/0-my-shot.png`,
			`${dir}/1-my-shot.png`,
		]);
		expect(await deps.fs.readBytes(`${dir}/0-my-shot.png`)).toEqual(bytes);
		const [, , asked] = questions(await deps.fs.read(plan));
		expect(asked?.reply).toBe(`see ${replied.attachments.join(" ")}`);

		// Gone with the task, so nothing outlives what it was attached to.
		await remove(deps, "alpha");
		expect(await deps.fs.exists(dir)).toBe(false);
	});

	it("reads attachments off disk for the cli", async () => {
		const shot = join(deps.root, "shot.png");
		await deps.fs.writeBytes(shot, new Uint8Array([9]));

		await reply(deps, "alpha", "Q3", "", { images: [shot] });

		const [, , asked] = questions(await deps.fs.read(plan));
		expect(asked?.reply).toBe(
			`${deps.service.attachmentsPath("alpha")}/0-shot.png`,
		);
		await expect(
			reply(deps, "alpha", "Q3", "x", { images: ["missing.png"] }),
		).toBail("usage", { message: "missing.png" });
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
		expect(await deps.fs.read(plan)).toBe(PLAN);
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
