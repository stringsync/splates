import { describe, expect, it } from "bun:test";
import { taskAdd } from "../board";
import { add } from "../tasks";
import { Testing } from "../testing";
import { refuseGroomer } from "./given";

/** Starts this command's caller as conversation `id`, its log begun as `persistent` says. */
async function caller(
	deps: Testing,
	id: string,
	persistent?: string,
): Promise<void> {
	await deps.service.conversationLog(id).append({
		kind: "start",
		id,
		agent: "fake",
		task: null,
		createdAt: "2026-10-19T00:00:00.000Z",
		...(persistent === undefined ? {} : { persistent }),
	});
	deps.proc.env.SPLATES_CONVERSATION = id;
}

describe("refuseGroomer", () => {
	it("refuses the groomer the commands that do work, and lets any other agent run them", async () => {
		await using deps = await Testing.open();
		await caller(deps, "c1");
		expect(await deps.service.callerRole()).toBeUndefined();
		await refuseGroomer(deps.service, "merge");

		await caller(deps, "c2", "groomer");
		expect(await deps.service.callerRole()).toBe("groomer");
		await expect(refuseGroomer(deps.service, "merge")).toBail("usage", {
			message: "never does them",
		});
	});

	it("refuses the groomer a task another task took, and leaves it any other", async () => {
		await using deps = await Testing.open();
		await taskAdd(deps, "rough", null);
		await taskAdd(deps, "taken", null);
		await add(deps, "work", { tasks: [2] });
		await caller(deps, "c1", "groomer");

		await refuseGroomer(deps.service, "task update", await deps.tasks.find(1));
		await expect(
			refuseGroomer(deps.service, "task update", await deps.tasks.find(2)),
		).toBail("exists", { message: "taken by 'work'" });
	});
});
