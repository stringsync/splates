import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Testing } from "@stringsync/splates-server/testing";
import { splates } from "./splates";

describe("queue pause and resume", () => {
	let env: Testing;
	let deps: Parameters<typeof splates.run>[0];
	let calls: { url: string; init: RequestInit | undefined }[];

	beforeEach(async () => {
		env = await Testing.open();
		env.ps.cd(env.root);
		calls = [];
		deps = {
			log: env.log,
			fs: env.fs,
			ps: env.ps,
			assets: env.assets,
			secrets: env.secrets,
			fetch: Object.assign(
				async (input: string | URL | Request, init?: RequestInit) => {
					calls.push({ url: String(input), init });
					return Response.json({ ok: true });
				},
				{ preconnect: () => {} },
			),
		};
	});

	afterEach(() => env.disposeAsync());

	it("pause updates the server's automatic starts", async () => {
		await splates.run(deps, [
			"queue",
			"pause",
			"--dev",
			"http://localhost:4310",
		]);
		expect(calls).toEqual([
			{
				url: "http://localhost:4310/api/workers/local",
				init: {
					method: "PUT",
					headers: {
						origin: "http://localhost:4310",
						"content-type": "application/json",
					},
					body: JSON.stringify({ paused: true }),
				},
			},
		]);
		expect(env.out()).toContain("paused automatic starts");
	});

	it("refuses pause from SPLATES_CONVERSATION before contacting the server", async () => {
		env.proc.env.SPLATES_CONVERSATION = "agent";
		await splates.run(deps, [
			"queue",
			"pause",
			"--dev",
			"http://localhost:4310",
		]);
		expect(calls).toEqual([]);
		expect(env.out()).toContain('"reason":"usage"');
	});

	it("refuses pause from SPLATES_STARTED_BY before contacting the server", async () => {
		env.proc.env.SPLATES_STARTED_BY = "agent";
		await splates.run(deps, [
			"queue",
			"pause",
			"--dev",
			"http://localhost:4310",
		]);
		expect(calls).toEqual([]);
		expect(env.out()).toContain('"reason":"usage"');
	});

	it("resume updates the server's automatic starts", async () => {
		await splates.run(deps, [
			"queue",
			"resume",
			"--dev",
			"http://localhost:4310",
		]);
		expect(calls).toEqual([
			{
				url: "http://localhost:4310/api/workers/local",
				init: {
					method: "PUT",
					headers: {
						origin: "http://localhost:4310",
						"content-type": "application/json",
					},
					body: JSON.stringify({ paused: false }),
				},
			},
		]);
		expect(env.out()).toContain("resumed automatic starts");
	});

	it("refuses resume from SPLATES_CONVERSATION before contacting the server", async () => {
		env.proc.env.SPLATES_CONVERSATION = "agent";
		await splates.run(deps, [
			"queue",
			"resume",
			"--dev",
			"http://localhost:4310",
		]);
		expect(calls).toEqual([]);
		expect(env.out()).toContain('"reason":"usage"');
	});

	it("refuses resume from SPLATES_STARTED_BY before contacting the server", async () => {
		env.proc.env.SPLATES_STARTED_BY = "agent";
		await splates.run(deps, [
			"queue",
			"resume",
			"--dev",
			"http://localhost:4310",
		]);
		expect(calls).toEqual([]);
		expect(env.out()).toContain('"reason":"usage"');
	});

	it("uses SPLATES_DEV when no server URL is given", async () => {
		env.proc.env.SPLATES_DEV = "http://localhost:4320";
		await splates.run(deps, ["queue", "pause"]);
		expect(calls[0]?.url).toBe("http://localhost:4320/api/workers/local");
	});

	it("reports a server refusal without reporting success", async () => {
		deps.fetch = Object.assign(
			async () => new Response("unavailable", { status: 503 }),
			{ preconnect: () => {} },
		);
		await splates.run(deps, [
			"queue",
			"resume",
			"--dev",
			"http://localhost:4310",
		]);
		expect(env.out()).toContain('"reason":"usage"');
		expect(env.out()).not.toContain("resumed automatic starts");
	});
});
