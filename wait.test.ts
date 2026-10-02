import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Duration, sleep } from "webappwiz/time";
import { add } from "./add";
import { PLAN_FILE } from "./plan";
import { remove } from "./remove";
import { replyTo } from "./reply";
import { Testing } from "./testing";
import { wait } from "./wait";

/** Long enough that a test only reaches it when waiting is genuinely stuck. */
const PATIENT = { timeout: Duration.secs(5), poll: Duration.ms(5) };

describe("wait", () => {
	let deps: Testing;

	beforeEach(async () => {
		deps = await Testing.open();
	});

	afterEach(() => deps.disposeAsync());

	it("returns with the reason once a task escalates while it waits", async () => {
		await add(deps, "alpha");
		deps.log.clear();

		const waiting = wait(deps, "alpha", PATIENT);
		await sleep(Duration.ms(20));
		await (await deps.service.find("alpha")).save({
			status: "escalated",
			escalations: [{ reason: "needs a human", at: new Date().toISOString() }],
		});
		await waiting;

		expect(deps.out()).toContain("escalated");
		expect(deps.out()).toContain("needs a human");
	});

	it("returns once nothing is left of the task", async () => {
		await add(deps, "alpha");
		await remove(deps, "alpha");
		deps.log.clear();

		await wait(deps, "alpha", PATIENT);

		expect(deps.out()).toContain("removed");
		expect(deps.out()).toContain("arbor log");
	});

	it("gives up on a task that keeps working", async () => {
		await add(deps, "alpha");

		await expect(
			wait(deps, "alpha", { timeout: Duration.ms(20), poll: Duration.ms(5) }),
		).toBail("timeout", {
			message: "still working",
			data: { task: "alpha", status: "working" },
		});
	});

	it("refuses a name nothing remembers", async () => {
		await expect(wait(deps, "nope", PATIENT)).toBail("not_found");
	});

	describe("--answered", () => {
		const blocked = (...items: string[]) =>
			`# alpha\n\n## Blocked\n\n${items.join("\n")}\n`;

		/** A task that escalated with these questions, its lease dropped. */
		async function escalated(...items: string[]): Promise<string> {
			await add(deps, "alpha");
			const worktree = await (await deps.service.find("alpha")).save({
				status: "escalated",
				lease: null,
			});
			const plan = `${worktree.path}/${PLAN_FILE}`;
			await deps.fs.write(plan, blocked(...items));
			deps.log.clear();
			return plan;
		}

		it("returns with the answers once every open question has one", async () => {
			const plan = await escalated(
				"- [x] 1. Run it. → pass",
				"- [ ] 2. Open /tmp/a.png. → pass",
				"- [ ] 3. Decide: keep or drop?",
			);

			const waiting = wait(deps, "alpha", { ...PATIENT, answered: true });
			await sleep(Duration.ms(20));
			await replyTo(deps, "alpha", "3", { text: "keep" });
			await waiting;

			expect(deps.out()).toBe(
				[
					"alpha answered",
					"  2. Open /tmp/a.png.",
					"    → pass",
					"  3. Decide: keep or drop?",
					"    → keep",
				].join("\n"),
			);
			expect(await deps.fs.read(plan)).toContain("keep or drop? → keep");
		});

		it("prints follow-ups under their answer", async () => {
			await escalated("- [ ] 1. Which table? → users", "  → and sessions");

			await wait(deps, "alpha", { ...PATIENT, answered: true });

			expect(deps.out()).toBe(
				[
					"alpha answered",
					"  1. Which table?",
					"    → users",
					"    → and sessions",
				].join("\n"),
			);
		});

		it("returns at once when nothing is open", async () => {
			await escalated("- [x] 1. Run it. → pass");

			await wait(deps, "alpha", { ...PATIENT, answered: true });

			expect(deps.out()).toBe("alpha has nothing unchecked under ## Blocked");
		});

		it("returns when the task is gone", async () => {
			await escalated("- [ ] 1. Run it.");
			await remove(deps, "alpha");
			deps.log.clear();

			await wait(deps, "alpha", { ...PATIENT, answered: true });

			expect(deps.out()).toContain("alpha removed");
		});

		it("gives up naming the questions still unanswered", async () => {
			await escalated(
				"- [ ] 1. Run it. → pass",
				"- [ ] 2. Open it.",
				"- [ ] 3. Decide it.",
			);

			await expect(
				wait(deps, "alpha", {
					timeout: Duration.ms(20),
					poll: Duration.ms(5),
					answered: true,
				}),
			).toBail("timeout", {
				message: "questions 2, 3 unanswered",
				data: { task: "alpha", status: "escalated", unanswered: ["2", "3"] },
			});
		});
	});
});
