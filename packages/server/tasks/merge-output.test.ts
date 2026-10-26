import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { FakeTimer } from "webappwiz/time/testing";
import { Testing } from "../testing";
import { add } from "./add";
import { mergeOutput } from "./merge-output";

describe("mergeOutput", () => {
	let deps: Testing;
	let timer: FakeTimer;
	let output: string;

	beforeEach(async () => {
		deps = await Testing.open();
		timer = new FakeTimer();
		await add(deps, "alpha");
		output = `${deps.root}-premerge.log`;
	});

	afterEach(() => deps.disposeAsync());

	const steps = (...more: { step: "land" }[]) =>
		deps.service.find("alpha").then((worktree) =>
			worktree.save({
				mergeSteps: {
					steps: [
						{ step: "rebase", at: "2026-10-26T10:00:00.000Z" },
						{ step: "test", at: "2026-10-26T10:00:01.000Z", output },
						...more.map((each) => ({
							...each,
							at: "2026-10-26T10:00:09.000Z",
						})),
					],
				},
			}),
		);

	const read = async (stream: ReadableStream<Uint8Array>) => {
		const reader = stream.getReader();
		const text = new TextDecoder();
		return {
			next: async () => text.decode((await reader.read()).value),
			done: async () => (await reader.read()).done,
		};
	};

	it("follows the premerge's output while it runs, and ends once it has", async () => {
		await steps();
		await deps.fs.write(output, "biome ok\n");

		const stream = await mergeOutput(
			{ service: deps.service, fs: deps.fs, timer },
			"alpha",
			1,
		);
		const reader = await read(stream ?? new ReadableStream());
		expect(await reader.next()).toBe("biome ok\n");

		await deps.fs.append(output, "tests 1/2\n");
		await steps({ step: "land" });
		timer.fireTimeouts();
		expect(await reader.next()).toBe("tests 1/2\n");
		expect(await reader.done()).toBe(true);
	});

	it("has nothing for a step that ran no command", async () => {
		await steps();

		expect(
			await mergeOutput(
				{ service: deps.service, fs: deps.fs, timer },
				"alpha",
				0,
			),
		).toBeNull();
	});
});
