import { describe, expect, it } from "bun:test";
import { SCRATCH, scratchLaunch } from "./scratch";

describe("scratchLaunch", () => {
	it("leaves an ordinary project agent unchanged", () => {
		expect(scratchLaunch(["agent"], "/repo", {}, "darwin", "/home/me")).toEqual(
			["agent"],
		);
	});

	it("sandboxes a scratch agent on macOS", () => {
		const argv = scratchLaunch(
			["agent", "--acp"],
			"/scratch/one",
			{ [SCRATCH]: "kimi" },
			"darwin",
			"/home/me",
		);

		expect(argv.slice(0, 2)).toEqual(["sandbox-exec", "-p"]);
		expect(argv.at(-3)).toBe("--");
		expect(argv.slice(-2)).toEqual(["agent", "--acp"]);
		expect(argv[2]).toContain('(allow file-write* (subpath "/scratch/one"))');
		expect(argv[2]).toContain(
			'(allow file-write* (subpath "/home/me/.kimi-code"))',
		);
		expect(argv[2]).not.toContain('(allow file-write* (subpath "/repo"))');
	});

	it("sandboxes a scratch agent on Linux", () => {
		const argv = scratchLaunch(
			["agent"],
			"/scratch/one",
			{ [SCRATCH]: "codex" },
			"linux",
			"/home/me",
		);

		expect(argv).toEqual([
			"bwrap",
			"--die-with-parent",
			"--new-session",
			"--unshare-all",
			"--share-net",
			"--ro-bind",
			"/",
			"/",
			"--tmpfs",
			"/tmp",
			"--bind",
			"/scratch/one",
			"/scratch/one",
			"--bind",
			"/home/me/.bun",
			"/home/me/.bun",
			"--bind",
			"/home/me/.npm",
			"/home/me/.npm",
			"--bind",
			"/home/me/.cache",
			"/home/me/.cache",
			"--bind",
			"/home/me/.codex",
			"/home/me/.codex",
			"--chdir",
			"/scratch/one",
			"--",
			"agent",
		]);
	});

	it("refuses a platform it cannot sandbox", () => {
		expect(() =>
			scratchLaunch(["agent"], "/scratch", { [SCRATCH]: "fake" }, "win32"),
		).toThrow("win32 is not supported");
	});
});
