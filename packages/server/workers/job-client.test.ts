import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { MemoryLogger } from "webappwiz/log";
import { Testing } from "../testing";
import { runOnRunner } from "./job-client";

describe("a job sent to run on a runner", () => {
	let deps: Testing;
	let sent: Record<string, unknown>[];

	const send = async (_url: string | URL | Request, init?: RequestInit) => {
		sent.push(JSON.parse(String(init?.body)));
		return new Response(`${JSON.stringify({ type: "exit", code: 0 })}\n`);
	};

	const run = (size?: { cpus?: number; memory?: number }) =>
		runOnRunner(
			{
				ps: deps.ps,
				fs: deps.fs,
				log: new MemoryLogger(),
				dev: "http://splates.test",
				send: send as typeof fetch,
			},
			{
				cwd: deps.root,
				argv: ["bun", "test"],
				...(size === undefined ? {} : { size }),
				output: () => {},
			},
		);

	beforeEach(async () => {
		deps = await Testing.open();
		sent = [];
	});

	afterEach(async () => {
		await deps[Symbol.asyncDispose]();
	});

	it("asks for 4 CPUs and 8 GB when the project sets no size", async () => {
		await run();

		expect(sent[0]).toMatchObject({ cpus: 4, memory: 8 });
	});

	it("asks for the project's size, and a command's own over it", async () => {
		await deps.fs.write(
			join(deps.root, "splates.config.ts"),
			'export default { job: { cpus: 2, memory: "512MB" } };\n',
		);

		await run();
		await run({ cpus: 6 });

		expect(sent).toMatchObject([
			{ cpus: 2, memory: 0.5 },
			{ cpus: 6, memory: 0.5 },
		]);
	});
});
