import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Testing } from "../testing";
import { add } from "./add";
import { reportToCaller, tell } from "./tell";

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
		// As `splates server` leaves a task conversation `orch` handed out with
		// `--agent` once it started the agent in conversation `agent`.
		await (await deps.service.find("alpha")).save({
			caller: "orch",
			dispatch: {
				agent: "fake",
				conversation: "agent",
			},
		});
	});

	afterEach(() => deps.disposeAsync());

	function runAs(conversation: string): void {
		deps.proc.env = {
			...deps.proc.env,
			SPLATES_CONVERSATION: conversation,
			SPLATES_DEV: "http://localhost:4270",
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
				text: {
					from: "orch",
					text: "> **Keep it?**\n- (a) Keep it",
					stop: false,
				},
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

	it("refuses outside splates server", async () => {
		await expect(tell({ ...deps, send }, "alpha", "merge")).toBail("usage", {
			message: "only an agent `splates server` started",
		});
	});

	it("names the url it misses in an agent of splates server that lost it", async () => {
		deps.proc.env = { ...deps.proc.env, SPLATES_CONVERSATION: "orch" };

		await expect(tell({ ...deps, send }, "alpha", "merge")).toBail("usage", {
			message: "SPLATES_DEV is not set",
		});
	});

	it("names the task by its project to a caller of another project's page", async () => {
		runAs("agent");

		await reportToCaller({ ...deps, send }, await deps.service.find("alpha"));

		const slug = deps.root.split("/").at(-1);
		expect(sent.map((each) => each.text)).toEqual([
			`[SPLATES REPORT ${slug}/alpha]`,
		]);
	});

	it("reports nothing to a caller stopping it itself, or for a task nobody handed out", async () => {
		runAs("orch");
		await reportToCaller({ ...deps, send }, await deps.service.find("alpha"));
		await add(deps, "beta");
		await reportToCaller({ ...deps, send }, await deps.service.find("beta"));

		expect(sent).toEqual([]);
	});

	it("reports nothing for a task a lane's orchestrator here handed out, which hears from its todos", async () => {
		runAs("agent");
		await deps.fs.mkdir(`${deps.splatesDir}/conversations`);
		await deps.fs.write(`${deps.splatesDir}/conversations/orch.jsonl`, "");
		await (await deps.service.find("alpha")).save({
			dispatch: { agent: "fake", conversation: "agent" },
		});

		await reportToCaller({ ...deps, send }, await deps.service.find("alpha"));

		expect(sent).toEqual([]);
	});

	it("reports a task another project's orchestrator handed out, which has no todo here to hear of", async () => {
		runAs("agent");
		await (await deps.service.find("alpha")).save({
			dispatch: { agent: "fake", conversation: "agent" },
		});

		await reportToCaller({ ...deps, send }, await deps.service.find("alpha"));

		const slug = deps.root.split("/").at(-1);
		expect(sent.map((each) => each.text)).toEqual([
			`[SPLATES REPORT ${slug}/alpha]`,
		]);
	});

	it("notes a server that refuses the report, and goes on", async () => {
		runAs("agent");
		status = 500;

		await reportToCaller({ ...deps, send }, await deps.service.find("alpha"));

		expect(
			deps.log.entries
				.filter((each) => each.level === "error")
				.map((each) => each.message),
		).toEqual(["splates server did not tell orch that 'alpha' stopped: 500"]);
	});
});
