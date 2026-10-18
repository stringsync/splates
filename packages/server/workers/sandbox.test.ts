import { describe, expect, it } from "bun:test";
import { sandboxArgv } from "./sandbox";

const homes = {
	home: "/home/u",
	splates: "/home/u/.splates",
	hidden: [".ssh"],
};

describe("sandboxArgv", () => {
	it("lets an agent in a project's clone write that project alone", () => {
		const cwd = "/home/u/.splates/worker/projects/web/web";
		const argv = sandboxArgv(homes, ["agent", "--acp"], cwd);
		expect(argv.slice(0, 5)).toEqual([
			"bwrap",
			"--die-with-parent",
			"--unshare-user",
			"--unshare-pid",
			"--unshare-ipc",
		]);
		expect(pairs(argv, "--tmpfs")).toEqual([
			"/tmp",
			"/home/u/.splates",
			"/home/u/.ssh",
		]);
		expect(triples(argv, "--bind")).toEqual([
			"/home/u/.splates/worker/projects/web",
		]);
		expect(triples(argv, "--ro-bind-try")).toEqual([
			"/home/u/.splates/worker/mirrors/web.git",
		]);
		expect(triples(argv, "--bind-try")).toContain("/home/u/.claude");
		expect(argv.slice(-5)).toEqual(["--chdir", cwd, "--", "agent", "--acp"]);
	});

	it("binds whatever splates's home hides after hiding it", () => {
		const argv = sandboxArgv(
			homes,
			["agent"],
			"/home/u/.splates/worker/projects/web/web",
		);
		expect(
			argv.indexOf("/home/u/.splates/worker/projects/web"),
		).toBeGreaterThan(argv.indexOf("/home/u/.splates"));
	});

	it("lets an agent elsewhere write its own directory alone", () => {
		const argv = sandboxArgv(homes, ["agent"], "/srv/repo");
		expect(triples(argv, "--bind")).toEqual(["/srv/repo"]);
		expect(triples(argv, "--ro-bind-try")).toEqual([]);
	});

	it("takes no directory that climbs out of splates's projects for a project", () => {
		const cwd = "/home/u/.splates/worker/projects/../../..";
		expect(triples(sandboxArgv(homes, ["agent"], cwd), "--bind")).toEqual([
			cwd,
		]);
	});
});

/** Each path `flag` takes once in `argv`. */
function pairs(argv: string[], flag: string): string[] {
	return argv.flatMap((each, at) =>
		each === flag ? [argv[at + 1] ?? ""] : [],
	);
}

/** Each source `flag` binds in `argv`, at its own path. */
function triples(argv: string[], flag: string): string[] {
	return argv.flatMap((each, at) =>
		each === flag && argv[at + 1] === argv[at + 2] ? [argv[at + 1] ?? ""] : [],
	);
}
