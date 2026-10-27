import { describe, expect, it } from "bun:test";
import { Testing } from "../testing";
import { cleared, deferralBlockers, deferralProblem } from "./deferral";

describe("deferral", () => {
	it("follows each blocker it named, keeping those that cleared", async () => {
		await using deps = await Testing.open();
		const merges = await deps.tasks.add("Build the upload client", null);
		const waits = await deps.tasks.add("Sign the uploads", null, {
			ready: true,
		});
		const deferred = await deps.tasks.add("Retry on 413", null);
		await deferred.defer(
			{
				why: "The fix needs the new client.",
				blockedBy: [merges.id, waits.id],
				questions: ["Keep the retry for old clients?"],
				outside: ["an upstream release"],
			},
			{ task: "alpha" },
		);
		await (await deps.tasks.find(merges.id)).remove("abc123");
		const blockers = () =>
			deps.tasks.all().then(async (all) =>
				deferralBlockers(
					(await deps.tasks.find(deferred.id)).state,
					all.map(({ state }) => state),
				),
			);

		expect(await blockers()).toEqual([
			{
				kind: "task",
				id: merges.id,
				subject: "Build the upload client",
				status: "merged",
			},
			{
				kind: "task",
				id: waits.id,
				subject: "Sign the uploads",
				status: "ready",
			},
			{
				kind: "question",
				text: "Keep the retry for old clients?",
				status: "open",
			},
			{ kind: "outside", what: "an upstream release", status: "open" },
		]);

		await (await deps.tasks.find(waits.id)).take("beta");
		await (await deps.tasks.find(deferred.id)).answer(0, "Yes, one release.");
		await (await deps.tasks.find(deferred.id)).outsideDone(0);

		expect((await blockers()).map(({ status }) => status)).toEqual([
			"merged",
			"working",
			"answered",
			"done",
		]);
		expect((await blockers()).map(cleared)).toEqual([true, false, true, true]);
		expect((await deps.tasks.find(deferred.id)).text).toContain(
			"Yes, one release.",
		);
		await expect(
			(await deps.tasks.find(deferred.id)).outsideDone(1),
		).rejects.toThrow("no deferred outside blocker 2");
	});

	it("names nothing for a task never deferred", async () => {
		await using deps = await Testing.open();
		const task = await deps.tasks.add("Retry on 413", null);

		expect(deferralBlockers(task.state, [task.state])).toEqual([]);
	});

	it("asks for a why and a blocker, and is content with both", () => {
		expect(deferralProblem({})).toContain("--why");
		expect(deferralProblem({ why: "x" })).toContain("--blocked-by");
		expect(deferralProblem({ why: "x", questions: ["Which?"] })).toBeNull();
	});
});
