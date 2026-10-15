import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { add } from "./add";
import { reportToCaller, tell } from "./tell";
import { Testing } from "./testing";

describe("tell", () => {
	let deps: Testing;
	let sent: { url: string; origin: string | null; text: unknown }[];
	let status: number;

	const send = async (url: string, init: RequestInit) => {
		sent.push({
			url,
			origin: new Headers(init.headers).get("origin"),
			text:
				init.body instanceof FormData
					? init.body.get("text")
					: JSON.parse(String(init.body)),
		});
		return new Response("{}", { status });
	};

	beforeEach(async () => {
		deps = await Testing.open();
		sent = [];
		status = 200;
		await add(deps, "alpha");
		// As `arbor dev` leaves a task conversation `orch` handed out once it
		// started the agent in conversation `agent`.
		await (await deps.service.find("alpha")).save({
			caller: "orch",
			dispatch: { agent: "fake", conversation: "agent" },
		});
	});

	afterEach(() => deps.disposeAsync());

	function runAs(conversation: string): void {
		deps.proc.env = {
			...deps.proc.env,
			ARBOR_CONVERSATION: conversation,
			ARBOR_DEV: "http://localhost:4270",
		};
	}

	it("says it in the conversation of the agent the task was handed to", async () => {
		runAs("orch");

		const to = await tell(
			{ ...deps, send },
			"alpha",
			"> **Keep it?**\n- (a) Keep it",
		);

		expect(to).toBe("agent");

		expect(sent).toEqual([
			{
				url: "http://localhost:4270/api/conversations/agent/tell",
				origin: "http://localhost:4270",
				text: { from: "orch", text: "> **Keep it?**\n- (a) Keep it" },
			},
		]);
	});

	it("refuses any conversation but the one that handed the task out", async () => {
		runAs("someone-else");

		await expect(tell({ ...deps, send }, "alpha", "merge")).toBail("usage", {
			message: "not handed out by this conversation",
		});
		expect(sent).toEqual([]);
	});

	it("refuses outside arbor dev", async () => {
		await expect(tell({ ...deps, send }, "alpha", "merge")).toBail("usage", {
			message: "only an agent `arbor dev` started",
		});
	});

	it("reports a task stopping to the conversation that handed it out", async () => {
		runAs("agent");

		await reportToCaller({ ...deps, send }, await deps.service.find("alpha"));

		expect(sent).toEqual([
			{
				url: "http://localhost:4270/api/conversations/orch/prompt",
				origin: "http://localhost:4270",
				text: "[ARBOR REPORT alpha]",
			},
		]);
	});

	it("reports nothing to a caller stopping it itself, or for a task nobody handed out", async () => {
		runAs("orch");
		await reportToCaller({ ...deps, send }, await deps.service.find("alpha"));
		await add(deps, "beta");
		await reportToCaller({ ...deps, send }, await deps.service.find("beta"));

		expect(sent).toEqual([]);
	});

	it("notes a server that refuses the report, and goes on", async () => {
		runAs("agent");
		status = 500;

		await reportToCaller({ ...deps, send }, await deps.service.find("alpha"));

		expect(
			deps.log.entries
				.filter((each) => each.level === "error")
				.map((each) => each.message),
		).toEqual(["arbor dev did not tell orch that 'alpha' stopped: 500"]);
	});
});
