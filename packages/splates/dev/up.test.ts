import { describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { FakePs } from "webappwiz/system/testing";
import { up } from "./up";

/** A checkout under a path needing shell quoting, reached from a task's tree. */
function machine(nested = false) {
	const ps = new FakePs();
	if (nested) {
		ps.setEnv({ TMUX: "/tmp/tmux/default,123,0" });
	}
	const commands: string[][] = [];
	ps.spawnCapture = async (argv) => ({
		exitCode: 0,
		stdout:
			argv[0] === "git"
				? "/Users/person/Project's plates/.git\n"
				: "tmux 3.6\n",
		stderr: "",
	});
	ps.spawn = async (argv) => {
		commands.push(argv);
		return { exitCode: 0 };
	};
	return { ps, commands, log: new MemoryLogger() };
}

describe("dev up", () => {
	it("starts or attaches from the main checkout, keeping paths as literal argv", async () => {
		const deps = machine();
		await up(deps);
		expect(deps.commands).toEqual([
			[
				"tmux",
				"new-session",
				"-A",
				"-s",
				"splates",
				"-c",
				"/Users/person/Project's plates",
				"/Users/person/Project's plates/bin/splates",
				"server",
				"--keepalive",
			],
		]);
	});

	it("switches the existing client instead of trying to nest tmux", async () => {
		const deps = machine(true);
		deps.ps.exit = () => {};
		await up(deps);
		expect(deps.commands).toEqual([
			["tmux", "switch-client", "-t", "=splates"],
		]);
	});

	it("explains how to install tmux without starting a server", async () => {
		const deps = machine();
		deps.ps.spawnCapture = async () => {
			throw new Error("ENOENT");
		};
		await expect(up(deps)).rejects.toThrow("brew install tmux");
		expect(deps.commands).toEqual([]);
	});
});
