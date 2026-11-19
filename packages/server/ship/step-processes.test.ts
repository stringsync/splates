import { describe, expect, it } from "bun:test";
import { FakePs } from "core/system/testing";
import { commandLine, ShellStepProcesses } from "./step-processes";

describe("ShellStepProcesses", () => {
	it("passes the step the flags its target planned with", () => {
		expect(
			commandLine(
				{
					command: "bin/vex ship",
					target: "@stringsync/vexml",
					step: "pin-mdom",
					bump: "minor",
					upstream: { "@stringsync/mdom": "1.5.0" },
				},
				"run",
			),
		).toBe(
			"bin/vex ship run pin-mdom --target @stringsync/vexml --bump minor --upstream @stringsync/mdom=1.5.0",
		);
	});

	it("passes a reviewed version in place of a bump", () => {
		expect(
			commandLine(
				{
					command: "bin/s2s ship",
					target: "staging",
					step: "deploy",
					version: "0.1.4",
					upstream: {},
				},
				"done",
			),
		).toBe("bin/s2s ship done deploy --target staging --version 0.1.4");
	});

	it("quotes a word the shell would split", () => {
		expect(
			commandLine(
				{
					command: "bin/net ship",
					target: "net prod",
					step: "deploy",
					upstream: {},
				},
				"done",
			),
		).toBe("bin/net ship done deploy --target 'net prod'");
	});

	it("reads what done found released from its stderr", async () => {
		const ps = new FakePs();
		ps.setCaptureOutput(
			"true\n",
			'checking npm\n{"type":"released","version":"1.5.0"}\n',
		);
		const answer = await new ShellStepProcesses(ps, "/r").done({
			command: "bin/mdom ship",
			target: "@stringsync/mdom",
			step: "publish",
			upstream: {},
		});
		expect(answer).toEqual({ done: true, released: "1.5.0" });
	});
});
