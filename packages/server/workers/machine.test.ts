import { describe, expect, it } from "bun:test";
import { FakeFs, FakePs } from "core/system/testing";
import { platformLabel } from "./list";
import { cwdPids, hostOf, LocalWorkerMachine } from "./machine";

describe("machine", () => {
	it("shows a worker under WSL as linux (wsl2)", () => {
		const ps = new FakePs();
		ps.setEnv({ WSL_DISTRO_NAME: "splates" });

		const host = hostOf(ps);

		expect(platformLabel({ platform: "linux", host })).toBe("linux (wsl2)");
	});

	it("shows a worker on the bare machine as its platform alone", () => {
		const host = hostOf(new FakePs());

		expect(platformLabel({ platform: "linux", host })).toBe("linux");
	});

	it("picks the processes working in a folder or under it, not a sibling sharing its prefix", () => {
		const output = [
			"p10",
			"n/work/task",
			"p11",
			"n/work/task/web",
			"p12",
			"n/work/task-other",
			"p13",
			"n/elsewhere",
			"p14",
			"n/work/task (deleted)",
			"p15",
			"n/work/task/web (deleted)",
		].join("\n");

		expect(cwdPids(output, "/work/task/")).toEqual([10, 11, 14, 15]);
	});

	it("stops processes under a folder while skipping excluded pids and itself", async () => {
		const ps = new FakePs();
		ps.pid = 900;
		ps.setCaptureOutput(
			[
				"p900",
				"n/work/task",
				"p1000",
				"n/work/task",
				"p1001",
				"n/work/task/web",
				"p1002",
				"n/elsewhere",
			].join("\n"),
			"",
		);
		const machine = new LocalWorkerMachine(ps, new FakeFs());

		await machine.stopUnder("/work/task", [1000]);

		expect(ps.getCalls()).toEqual(["lsof -a -d cwd -Fpn", "kill -TERM 1001"]);
	});

	it("stops a pid and its descendants while skipping the worker and excluded pids", async () => {
		const ps = new FakePs();
		ps.setProcesses([
			{ pid: 1, ppid: 0, pgid: 1, tpgid: 0, command: "init" },
			{ pid: 500, ppid: 1, pgid: 500, tpgid: 0, command: "agent" },
			{ pid: 600, ppid: 500, pgid: 600, tpgid: 0, command: "zsh -c bun dev" },
			{ pid: 601, ppid: 600, pgid: 601, tpgid: 0, command: "bun run vite" },
			{ pid: 602, ppid: 601, pgid: 602, tpgid: 0, command: "esbuild" },
			{ pid: 700, ppid: 500, pgid: 700, tpgid: 0, command: "other" },
		]);
		const machine = new LocalWorkerMachine(ps, new FakeFs());

		await machine.stopProcessTree([600, ps.pid, 500], [500]);

		expect(ps.getCalls()).toEqual(["kill -TERM 600 601 602"]);
	});

	it("does nothing when asked to stop no pids or only excluded pids", async () => {
		const ps = new FakePs();
		const machine = new LocalWorkerMachine(ps, new FakeFs());

		await machine.stopProcessTree([]);
		await machine.stopProcessTree([ps.pid, 500], [500]);

		expect(ps.getCalls()).toEqual([]);
	});
});
