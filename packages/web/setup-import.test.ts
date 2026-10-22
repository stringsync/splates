// The page's `location`, which every request is scoped by.
import "./register-dom";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { SetupImport } from "./setup-import";

describe("SetupImport", () => {
	const real = globalThis.fetch;
	let asked: { path: string; body: unknown }[];
	let answers: Response[];

	beforeEach(() => {
		asked = [];
		answers = [];
		globalThis.fetch = (async (path: string, init?: RequestInit) => {
			asked.push({ path, body: init?.body });
			return answers.shift() ?? new Response(null, { status: 204 });
		}) as typeof fetch;
	});
	afterEach(() => {
		globalThis.fetch = real;
	});

	const file = (text: string) => new File([text], "export.json");

	it("sends the file, imports it, and says what it wrote and kept", async () => {
		const flow = new SetupImport();
		answers = [
			new Response(null, { status: 204 }),
			Response.json({
				written: ["project hooks.json"],
				kept: ["project conversations/a.jsonl"],
				asked: ["API_TOKEN"],
			}),
		];
		await flow.choose(file("{}"));
		expect(flow.state).toEqual({
			kind: "done",
			written: 1,
			kept: 1,
			asked: ["API_TOKEN"],
		});
		expect(asked[0]?.path).toMatch(
			/^\/api\/config\/import\/parts\?upload=.+&part=0$/,
		);
		expect(asked[0]?.body).toBe("{}");
		const upload = new URLSearchParams(asked[0]?.path.split("?")[1]).get(
			"upload",
		);
		expect(JSON.parse(String(asked[1]?.body))).toEqual({
			upload,
			force: false,
		});
	});

	it("stops on files that differ, then overwrites them with the same upload", async () => {
		const flow = new SetupImport();
		answers = [
			new Response(null, { status: 204 }),
			Response.json(
				{
					reason: "exists",
					message: "differ",
					conflicts: ["project hooks.json"],
				},
				{ status: 409 },
			),
		];
		await flow.choose(file("{}"));
		expect(flow.state).toEqual({
			kind: "conflicts",
			conflicts: ["project hooks.json"],
		});

		answers = [Response.json({ written: ["project hooks.json"], kept: [] })];
		await flow.overwrite();
		expect(JSON.parse(String(asked[2]?.body)).force).toBe(true);
		expect(flow.state).toEqual({
			kind: "done",
			written: 1,
			kept: 0,
			asked: [],
		});
	});

	it("says why when the server refuses the file", async () => {
		const flow = new SetupImport();
		answers = [
			new Response(null, { status: 204 }),
			Response.json(
				{ reason: "usage", message: "the file is not a splates export" },
				{ status: 400 },
			),
		];
		await flow.choose(file("nope"));
		expect(flow.state).toEqual({
			kind: "failed",
			message: "the file is not a splates export",
		});
	});
});
