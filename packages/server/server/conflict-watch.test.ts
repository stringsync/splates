import { describe, expect, it } from "bun:test";
import { AGENT, FakeAgent } from "../agents/testing";
import { Conversations } from "../conversations";
import { add, ConflictChecks } from "../tasks";
import { Testing } from "../testing";
import { ConflictWatch } from "./conflict-watch";
import { eventually } from "./testing";

describe("server conflict notices", () => {
	// scry-ignore simple-test-setup: a working agent and a later base commit are the integration scenario, not setup shared by other tests.
	it("detects a base move without an open page and nudges the working agent once", async () => {
		await using deps = await Testing.open();
		await add(deps, "alpha");
		const worktree = await deps.service.find("alpha");
		await deps.commit(worktree.path, "README.md", "task\n", "task edit");
		const agent = new FakeAgent();
		agent.steering = "injected";
		let finish: (() => void) | undefined;
		agent.turn = () =>
			new Promise((resolve) => {
				finish = () => resolve("end_turn");
			});
		const conversations = new Conversations(
			`${deps.splatesDir}/conversations`,
			[AGENT],
			{ launch: agent.launch },
		);
		const conversation = await conversations.start("fake", {
			task: "alpha",
			cwd: worktree.path,
		});
		await conversation.prompt("work");
		expect(await eventually(async () => finish !== undefined, 5000)).toBe(true);
		const watch = new ConflictWatch(deps, conversations);
		try {
			await watch.start();
			await deps.commit(deps.root, "README.md", "trunk\n", "another landing");
			expect(
				await eventually(
					async () =>
						(
							await new ConflictChecks(deps.storage).read("alpha")
						)?.files.includes("README.md") === true,
					8000,
				),
			).toBe(true);
			expect(
				await eventually(async () => agent.steered.length === 1, 5000),
			).toBe(true);
			expect(agent.steered[0]).toContain(
				"will conflict with main in: README.md",
			);
			await watch.sweep();
			expect(agent.steered).toHaveLength(1);
			expect((await deps.service.find("alpha")).mergeAttempts).toBe(0);
		} finally {
			await watch.disposeAsync();
			finish?.();
			await conversations.disposeAsync();
		}
	}, 20000);
});
