import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	setDefaultTimeout,
} from "bun:test";
import { join } from "node:path";
import { Testing } from "../testing";
import { NoteSaves } from "./saves";

// Real git in a repo and a bare remote.
setDefaultTimeout(30_000);

describe("note saves with a central remote", () => {
	let deps: Testing;
	let remote: string;
	beforeEach(async () => {
		deps = await Testing.open();
		remote = join(deps.config.worktreeRoot, "..", "remote.git");
		await deps.gitCli(
			deps.root,
			"init",
			"--quiet",
			"--bare",
			"-b",
			"main",
			remote,
		);
		await deps.gitCli(deps.root, "remote", "add", "origin", remote);
		await deps.gitCli(deps.root, "push", "--quiet", "origin", "main");
		deps.config.remote = "origin";
	});
	afterEach(() => deps.disposeAsync());

	it("lands the note on the remote's trunk and leaves no branch behind", async () => {
		expect(
			await new NoteSaves(deps).save({
				path: null,
				file: "tests.md",
				description: "How tests run",
				body: "Run them under bun.",
				from: null,
			}),
		).toMatchObject({ status: "landed" });
		expect(await deps.gitCli(remote, "log", "-1", "--format=%s", "main")).toBe(
			"Add note tests.md: How tests run",
		);
		expect(await deps.gitCli(remote, "branch", "--list")).toBe("* main");
		expect(await deps.fs.exists(join(deps.root, "notes/tests.md"))).toBe(true);
	});
});
