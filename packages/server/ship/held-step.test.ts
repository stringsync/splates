import { describe, expect, it } from "bun:test";
import { FakePs } from "core/system/testing";
import type { AgentFrame, AgentProcess } from "../agents/process";
import { ShellStepProcesses } from "./step-processes";

describe("a step a worker holds", () => {
	it("holds the last frame whose lines all ended, never one that left a line half written", async () => {
		const frames = [
			'{"type":"output","text":"a"}\n{"type":"upd',
			'ate","line":"b"}\n',
			"plain\n",
		];
		const process: AgentProcess = {
			pid: 9,
			input: new WritableStream(),
			output: new ReadableStream<AgentFrame>({
				start: (controller) => {
					frames.forEach((text, index) => {
						controller.enqueue({
							bytes: new TextEncoder().encode(text),
							seq: index + 1,
						});
					});
					controller.close();
				},
			}),
			ack: () => {},
			handle: { worker: "local", channel: 4 },
			stderr: () => "",
			exited: Promise.resolve(0),
			kill: () => {},
		};
		const step = new ShellStepProcesses(new FakePs(), "/root", {
			launch: () => process,
			resume: () => process,
		}).run({ command: "c", target: "t", step: "s", upstream: {} });
		expect(step.handle).toEqual({ worker: "local", channel: 4 });
		const held = await Array.fromAsync(step.lines, () => step.held);
		// Frame 1 ends in half a line, so nothing is held until frame 2 completes it.
		expect(held).toEqual([null, 2, 3]);
	});
});
