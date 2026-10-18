import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { add } from "../tasks";
import { Testing } from "../testing";
import { TaskBranches } from "./branches";
import { GitHubApp } from "./github-app";

describe("TaskBranches with the GitHub App", () => {
	let deps: Testing;
	let remote: string;
	let tree: string;
	let asked: { url: string; body: unknown }[];
	let branches: TaskBranches;

	beforeEach(async () => {
		deps = await Testing.open();
		remote = join(deps.config.worktreeRoot, "..", "remote.git");
		await deps.gitCli(deps.root, "init", "--bare", remote);
		await deps.gitCli(deps.root, "remote", "add", "origin", remote);
		deps.config.remote = "origin";
		await add(deps, "alpha");
		tree = (await deps.service.find("alpha")).path;
		await deps.gitCli(
			deps.root,
			"remote",
			"set-url",
			"origin",
			"git@github.com:stringsync/splates.git",
		);
		// Where the App's https URL really goes, so the push lands here.
		await deps.gitCli(
			deps.root,
			"config",
			`url.${remote}.insteadOf`,
			"https://github.com/stringsync/splates.git",
		);
		asked = [];
		const app = new GitHubApp("1", "unused", {
			fetch: (async (url: string, init?: RequestInit) => {
				asked.push({
					url,
					body: init?.body === undefined ? null : JSON.parse(String(init.body)),
				});
				return Response.json(
					url.endsWith("/installation")
						? { id: 7 }
						: { token: "minted", expires_at: "2099-01-01T00:00:00Z" },
				);
			}) as typeof fetch,
		});
		app.jwt = () => "jwt";
		branches = new TaskBranches(deps.git, deps.config, {
			app: async () => app,
		});
	});

	afterEach(() => deps.disposeAsync());

	it("pushes with a token the App mints for the task, once", async () => {
		await deps.commit(tree, "a.txt", "one\n", "a");

		expect((await branches.push("alpha", "task/alpha")).status).toBe("pushed");
		await branches.push("alpha", "task/alpha");

		expect(await deps.gitCli(remote, "rev-parse", "splates/alpha")).toBe(
			await deps.gitCli(tree, "rev-parse", "HEAD"),
		);
		expect(asked).toEqual([
			{
				url: "https://api.github.com/repos/stringsync/splates/installation",
				body: null,
			},
			{
				url: "https://api.github.com/app/installations/7/access_tokens",
				body: {
					repositories: ["splates"],
					permissions: { contents: "write" },
				},
			},
		]);
	});
});
