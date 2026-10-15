import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { add } from "./add";
import { ROSTERED } from "./fake-agent";
import { handoff } from "./handoff";
import { handOff } from "./tell";
import { Testing } from "./testing";

describe("handoff", () => {
	let deps: Testing;

	beforeEach(async () => {
		deps = await Testing.open();
	});

	afterEach(() => deps.disposeAsync());

	it("hands the task to another agent, which answers to the user as the one at work on it did", async () => {
		deps.proc.env.ARBOR_CONVERSATION = "c1";
		await add(deps, "alpha");
		expect((await deps.service.find("alpha")).caller).toBe("c1");

		await handoff(
			deps,
			"alpha",
			{ agent: "fake", model: "Small", prompt: "Take the styles." },
			[ROSTERED],
		);

		const found = await deps.service.find("alpha");
		expect(found.state?.dispatch).toEqual({
			agent: "fake",
			model: "small",
			prompt: "Take the styles.",
			handoff: true,
		});
		expect(found.caller).toBeNull();
		expect(handOff(found)).toBeNull();
		expect(deps.out()).toContain("agent:    fake (small)");
		expect(deps.out()).toContain("the task is the new agent's now");
	});

	it("hands on a task an agent was handed by a handoff, dropping what the last one was told", async () => {
		await add(deps, "alpha");
		await (await deps.service.find("alpha")).save({
			dispatch: {
				agent: "fake",
				prompt: "Take the styles.",
				conversation: "c2",
				handoff: true,
			},
		});
		deps.proc.env.ARBOR_CONVERSATION = "c2";

		await handoff(deps, "alpha", { agent: "fake" }, [ROSTERED]);

		expect((await deps.service.find("alpha")).state?.dispatch).toEqual({
			agent: "fake",
			handoff: true,
		});
	});

	it("hands the task to an agent that answers to this conversation, with relay", async () => {
		deps.proc.env.ARBOR_CONVERSATION = "c1";
		await add(deps, "alpha");

		await handoff(
			deps,
			"alpha",
			{ agent: "fake", model: "Small" },
			[ROSTERED],
			{
				relay: true,
			},
		);

		const found = await deps.service.find("alpha");
		expect(found.caller).toBe("c1");
		expect(found.state?.dispatch).toEqual({
			agent: "fake",
			model: "small",
			handoff: true,
		});
		await found.save({
			dispatch: { ...found.state?.dispatch, agent: "fake", conversation: "c2" },
		});
		expect(handOff(await deps.service.find("alpha"))).toEqual({
			caller: "c1",
			conversation: "c2",
		});
		expect(deps.out()).toContain('say "## ⏳ Working alpha: on <agent>"');
	});

	it("refuses to relay outside arbor dev, where nothing would report back", async () => {
		await add(deps, "alpha");

		await expect(
			handoff(deps, "alpha", { agent: "fake" }, [ROSTERED], { relay: true }),
		).toBail("usage", { message: "--relay needs `arbor dev`" });
		expect((await deps.service.find("alpha")).state?.dispatch).toBeUndefined();
	});

	it("refuses a task another conversation is at work on", async () => {
		deps.proc.env.ARBOR_CONVERSATION = "c1";
		await add(deps, "alpha");
		deps.proc.env.ARBOR_CONVERSATION = "c2";

		await expect(handoff(deps, "alpha", { agent: "fake" }, [ROSTERED])).toBail(
			"usage",
			{ message: "worked by conversation c1" },
		);
		expect((await deps.service.find("alpha")).state?.dispatch).toBeUndefined();
	});

	it("refuses an agent an orchestrator handed its task to, which escalates instead", async () => {
		await add(deps, "alpha");
		deps.proc.env.ARBOR_CONVERSATION = "c2";
		deps.proc.env.ARBOR_CALLER = "c1";

		await expect(handoff(deps, "alpha", { agent: "fake" }, [ROSTERED])).toBail(
			"usage",
			{ message: ["answers to conversation c1", "escalate"] },
		);
	});

	it("refuses a task that is not there, or an agent the roster does not list", async () => {
		await expect(handoff(deps, "nope", { agent: "fake" }, [ROSTERED])).toBail(
			"not_found",
		);
		await add(deps, "alpha");
		await expect(
			handoff(deps, "alpha", { agent: "nobody" }, [ROSTERED]),
		).toBail("usage", { message: "no agent 'nobody' on the roster" });
		expect((await deps.service.find("alpha")).state?.dispatch).toBeUndefined();
	});
});
