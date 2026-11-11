import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	onTestFinished,
} from "bun:test";
import { Testing } from "@splates/server/testing";
import { splates } from "./splates";

describe("splates progress", () => {
	let testing: Testing;

	beforeEach(async () => {
		testing = await Testing.open();
		testing.ps.cd(testing.root);
		await testing.service.conversationLog("c1").append({
			kind: "start",
			id: "c1",
			agent: "fake",
			task: null,
			createdAt: "2026-10-16T10:00:00Z",
		});
	});

	afterEach(() => testing.disposeAsync());

	/** Runs `splates progress` against a stand-in server; returns what it was sent. */
	async function progress(
		args: string[],
		reachable = true,
	): Promise<{ path: string; body: unknown }[]> {
		const sent: { path: string; body: unknown }[] = [];
		const server = Bun.serve({
			port: 0,
			fetch: async (request) => {
				sent.push({
					path: new URL(request.url).pathname,
					body: await request.json(),
				});
				return Response.json({});
			},
		});
		onTestFinished(() => server.stop(true));
		testing.proc.env.SPLATES_DEV = reachable
			? `http://localhost:${server.port}`
			: "http://localhost:1";
		await splates.run(
			{
				log: testing.log,
				fs: testing.fs,
				ps: testing.ps,
				assets: testing.assets,
				secrets: testing.secrets,
			},
			["progress", ...args, "--conversation", "c1"],
		);
		return sent;
	}

	it("sends the note, title and percent to the server and prints the card", async () => {
		const sent = await progress([
			"build",
			"parsing score-05",
			"--title",
			"Import",
			"--percent",
			"40",
		]);

		expect(sent).toEqual([
			{
				path: "/api/conversations/c1/progress",
				body: {
					id: "build",
					title: "Import",
					percent: 40,
					note: "parsing score-05",
				},
			},
		]);
		expect(testing.out()).toContain("⏳ Import 40% · parsing score-05");
	});

	it("finishes a card with --done", async () => {
		const sent = await progress(["build", "--done"]);

		expect(sent.map((each) => each.body)).toEqual([
			{ id: "build", state: "done" },
		]);
		expect(testing.out()).toContain("✅ build");
	});

	it("only prints the card when the server cannot be reached", async () => {
		const sent = await progress(["build", "still going"], false);

		expect(sent).toEqual([]);
		expect(testing.out()).toContain("⏳ build · still going");
	});
});
