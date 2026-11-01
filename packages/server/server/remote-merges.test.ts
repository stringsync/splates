import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	setDefaultTimeout,
} from "bun:test";
import { join } from "node:path";
import { MemoryLogger } from "core/log";
import { mergeOnServer } from "../merge";
import type { Repository } from "../records";
import { Testing } from "../testing";
import type { ServerSend } from "../workers";
import { MergeRoutes } from "./merges";
import type { Project } from "./project-types";

setDefaultTimeout(30_000);

const URL_ = "http://localhost:4310";

// Real git in a repo, a bare remote and a worker's clone of it.
describe("merges of a worker's pushed branch", () => {
	let deps: Testing;
	let remote: string;
	let worker: string;
	let send: ServerSend;

	beforeEach(async () => {
		deps = await Testing.open();
		const base = join(deps.config.worktreeRoot, "..");
		remote = join(base, "remote.git");
		worker = join(base, "worker");
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
		await deps.gitCli(base, "clone", "--quiet", remote, worker);
		await deps.gitCli(worker, "config", "user.email", "w@example.com");
		await deps.gitCli(worker, "config", "user.name", "worker");
		await deps.gitCli(worker, "config", "commit.gpgsign", "false");
		deps.config.remote = "origin";
		deps.config.postRewrite = null;
		deps.config.preMerge = null;
		const routes = new MergeRoutes(
			deps as unknown as Project,
			async () => ({ ...deps, dispose: () => {} }) as unknown as Repository,
		);
		send = async (url, init) => {
			const request = new Request(url, init);
			const { pathname } = new URL(url);
			if (pathname === "/api/merges") {
				return routes.startMerge(request);
			}
			return request.method === "DELETE"
				? routes.doneMerge(request)
				: routes.readMerge(request);
		};
	});
	afterEach(() => deps.disposeAsync());

	/** Pushes a commit of `file` from the worker as `splates/beta`; its head. */
	const push = async (file: string, body: string): Promise<string> => {
		await deps.commit(worker, file, body, `add ${file}`);
		await deps.gitCli(
			worker,
			"push",
			"--quiet",
			"-f",
			"origin",
			"HEAD:refs/heads/splates/beta",
		);
		return (await deps.gitCli(worker, "rev-parse", "HEAD")).trim();
	};

	const ask = (head: string, attempts = 0) => ({
		task: "beta",
		cwd: worker,
		pid: 4242,
		hostname: "worker",
		env: {},
		message: "",
		remote: { head, attempts, conflicts: 0 },
	});

	it("lands it on the remote's trunk from a checkout of its own, which goes", async () => {
		const head = await push("beta.txt", "beta\n");

		const outcome = await mergeOnServer(
			{ server: { url: URL_, send }, slug: "repo", log: new MemoryLogger() },
			ask(head),
			{},
		);

		expect(outcome).toBe("landed");
		const trunk = await deps.gitCli(remote, "log", "--format=%s", "-1", "main");
		expect(trunk).toBe("add beta.txt");
		expect((await deps.service.find("beta")).gone).toBe(true);
	});

	it("refuses a conflict with the budget spent, leaving no checkout", async () => {
		await deps.commit(deps.root, "README.md", "trunk side\n", "trunk edit");
		await deps.gitCli(deps.root, "push", "--quiet", "origin", "main");
		const head = await push("README.md", "worker side\n");

		await expect(
			mergeOnServer(
				{ server: { url: URL_, send }, slug: "repo", log: new MemoryLogger() },
				ask(head, 1),
				{},
			),
		).toBail("conflict", { message: "README.md" });

		expect((await deps.service.find("beta")).gone).toBe(true);
	});
});
