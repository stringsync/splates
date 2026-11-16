import { describe, expect, it } from "bun:test";
import { CounterIdProvider } from "core/id";
import { MemoryLogger } from "core/log";
import { MemoryStorage } from "../storage/testing";
import { ShipCommands } from "./commands";
import { ShipComposer } from "./compose";
import { ShipEngine } from "./engine";
import { ShipFixes } from "./fixes";
import { ShipRunRoutes } from "./run-routes";
import { FakeShipPs, FakeStepProcesses } from "./testing";

describe("ShipRunRoutes", () => {
	it("starts a ship the page asks for and lists it", async () => {
		const { routes, processes } = setup();
		const started = await routes.shipRuns(
			request("", { picks: [{ name: "net" }] }),
		);
		expect(started.status).toBe(201);
		expect(await started.json()).toMatchObject({
			id: "0",
			status: "running",
			targets: [
				{ name: "net", command: "bin/net ship", steps: [{ id: "deploy" }] },
			],
		});
		await processes.started("net/deploy");
		const listed = await (await routes.shipRuns(request(""))).json();
		expect(listed.runs.map((each: { id: string }) => each.id)).toEqual(["0"]);
		const running = await (
			await routes.shipRuns(request("?status=running"))
		).json();
		expect(running.runs.map((each: { id: string }) => each.id)).toEqual(["0"]);
		const done = await (await routes.shipRuns(request("?status=done"))).json();
		expect(done.runs).toEqual([]);
		expect((await routes.shipRun(request("/0"))).status).toBe(200);
		expect((await routes.shipRun(request("/zz"))).status).toBe(404);
	});

	it("refuses to start a ship for a request the page did not send", async () => {
		const { routes, processes } = setup();
		const refused = await routes.shipRuns(
			request("", { picks: [{ name: "net" }] }, {}),
		);
		expect(refused.status).toBe(403);
		expect((await refused.json()).error).toContain(
			"Only the user starts a ship",
		);
		expect(processes.asked).toEqual([]);
	});

	it("refuses a pick it cannot compose", async () => {
		const { routes } = setup();
		const refused = await routes.shipRuns(
			request("", { picks: [{ name: "zz" }] }),
		);
		expect(refused.status).toBe(400);
		expect(await refused.json()).toEqual({
			error: 'No ship command serves "zz"',
		});
	});

	it("answers a prompt and retries a failed step", async () => {
		const { routes, processes } = setup();
		await routes.shipRuns(request("", { picks: [{ name: "net" }] }));
		const deploy = await processes.started("net/deploy");
		deploy.say({ type: "prompt", id: "p", kind: "confirm", question: "Go?" });
		await until(
			async () =>
				(await (await routes.shipRun(request("/0"))).json()).targets[0].steps[0]
					.status === "waiting",
		);
		const answered = await routes.shipRunAnswer(
			request("/0/answer", {
				target: "net",
				step: "deploy",
				prompt: "p",
				value: true,
			}),
		);
		expect(answered.status).toBe(200);
		expect(deploy.answers).toEqual([{ id: "p", value: true }]);

		deploy.exit(1);
		await until(
			async () =>
				(await (await routes.shipRun(request("/0"))).json()).status ===
				"failed",
		);
		const retried = await routes.shipRunRetry(
			request("/0/retry", { target: "net", step: "deploy" }),
		);
		expect(retried.status).toBe(200);
		await until(() => processes.runs.length === 2);
		const again = await routes.shipRunRetry(
			request("/0/retry", { target: "net", step: "deploy" }),
		);
		expect(again.status).toBe(409);
	});

	it("stops a run only from the page", async () => {
		const { routes, processes } = setup();
		await routes.shipRuns(request("", { picks: [{ name: "net" }] }));
		const deploy = await processes.started("net/deploy");
		const refused = await routes.shipRunStop(
			request("/0/stop", {}, { "sec-fetch-site": "none" }),
		);
		expect(refused.status).toBe(403);
		const stopped = await routes.shipRunStop(request("/0/stop", {}));
		expect(stopped.status).toBe(200);
		expect((await stopped.json()).status).toBe("stopped");
		expect(deploy.stopped).toBe(true);
	});

	it("sends a failed step to an agent from the page, and lets any task retry it", async () => {
		const { routes, processes } = setup();
		await routes.shipRuns(request("", { picks: [{ name: "net" }] }));
		(await processes.started("net/deploy")).exit(1);
		await until(
			async () =>
				(await (await routes.shipRun(request("/0"))).json()).status ===
				"failed",
		);
		const step = { target: "net", step: "deploy" };
		const outside = await routes.shipRunSend(request("/0/send", step, {}));
		expect(outside.status).toBe(403);
		const sent = await routes.shipRunSend(request("/0/send", step));
		expect(sent.status).toBe(200);
		expect((await sent.json()).task).toBe(3);
		const retried = await routes.shipRunFixRetry(
			request("/0/fix-retry", { ...step, task: "other" }, {}),
		);
		expect(retried.status).toBe(200);
		await until(() => processes.runs.length === 2);
	});

	it("takes an agent's note on the run or a step, and refuses one on a step it lacks", async () => {
		const { routes, processes } = setup();
		await routes.shipRuns(request("", { picks: [{ name: "net" }] }));
		await processes.started("net/deploy");
		const run = await routes.shipRunNote(
			request("/0/note", { task: "a", text: "token expired" }, {}),
		);
		expect(run.status).toBe(200);
		const step = await routes.shipRunNote(
			request(
				"/0/note",
				{ task: "a", text: "fix", target: "net", step: "deploy", link: "#9" },
				{},
			),
		);
		expect((await step.json()).notes).toMatchObject([
			{ task: "a", text: "token expired" },
			{ target: "net", step: "deploy", link: "#9" },
		]);
		const missing = await routes.shipRunNote(
			request(
				"/0/note",
				{ task: "a", text: "x", target: "net", step: "nope" },
				{},
			),
		);
		expect(missing.status).toBe(404);
		const bare = await routes.shipRunNote(
			request("/0/note", { task: "a" }, {}),
		);
		expect(bare.status).toBe(400);
	});

	it("streams the state, then each event", async () => {
		const { routes, processes } = setup();
		await routes.shipRuns(request("", { picks: [{ name: "net" }] }));
		const deploy = await processes.started("net/deploy");
		const response = await routes.shipRunEvents(request("/0/events"));
		const reader = (response.body as ReadableStream<Uint8Array>).getReader();
		deploy.say({ type: "update", line: "Deploying" });
		const text = await readUntil(reader, "Deploying");
		await reader.cancel();
		expect(text).toContain("event: state\n");
		expect(text).toContain(
			`event: run\ndata: {"type":"update","target":"net","step":"deploy","line":"Deploying"}`,
		);
	});

	it("lists the prompts open", async () => {
		const { routes, processes } = setup();
		await routes.shipRuns(request("", { picks: [{ name: "net" }] }));
		const deploy = await processes.started("net/deploy");
		expect(await (await routes.shipWaiting()).json()).toEqual([]);
		deploy.say({ type: "prompt", id: "p", kind: "confirm", question: "Go?" });
		await until(
			async () => (await (await routes.shipWaiting()).json()).length === 1,
		);
		expect(await (await routes.shipWaiting()).json()).toEqual([
			{
				run: "0",
				target: "net",
				step: "deploy",
				does: "Deploy",
				id: "p",
				prompt: { kind: "confirm", question: "Go?" },
				at: 5,
			},
		]);
	});
});

const net = {
	name: "net",
	dependencies: [],
	steps: [{ id: "deploy", does: "Deploy" }],
};

function setup() {
	const processes = new FakeStepProcesses();
	const engine = new ShipEngine({
		storage: new MemoryStorage(),
		processes,
		clock: { now: () => 5 },
		ids: new CounterIdProvider(),
		log: new MemoryLogger(),
	});
	const commands = new ShipCommands(
		["bin/net ship"],
		new FakeShipPs({
			"bin/net ship plan": net,
			"bin/net ship plan --target net": net,
		}),
		"/r",
	);
	const taken = new Map<number, string>();
	const fixes = new ShipFixes(
		engine,
		{
			add: async () => 3,
			start: async () => {},
			ended: async () => null,
			takenBy: async (task) => taken.get(task) ?? null,
		},
		new MemoryLogger(),
	);
	return {
		processes,
		taken,
		routes: new ShipRunRoutes(engine, new ShipComposer(commands), fixes),
	};
}

const page = { "sec-fetch-site": "same-origin" };

const request = (
	path: string,
	body?: unknown,
	headers: Record<string, string> = page,
) =>
	new Request(`http://x/api/ship/runs${path}`, {
		method: body === undefined ? "GET" : "POST",
		headers,
		...(body !== undefined && { body: JSON.stringify(body) }),
	});

async function until(check: () => boolean | Promise<boolean>): Promise<void> {
	for (let tries = 0; tries < 2000; tries++) {
		if (await check()) {
			return;
		}
		await Bun.sleep(1);
	}
	throw new Error("never came true");
}

/** What `reader` gives until it has given `seen`. */
async function readUntil(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	seen: string,
): Promise<string> {
	let text = "";
	while (!text.includes(seen)) {
		const { value } = await reader.read();
		text += new TextDecoder().decode(value);
	}
	return text;
}
