import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	setDefaultTimeout,
} from "bun:test";
import { MemoryLogger } from "core/log";
import { mergeOnServer } from "../merge";
import type { Facts, Repository } from "../records";
import { add } from "../tasks";
import { Testing } from "../testing";
import type { ServerSend } from "../workers";
import { MergeRoutes } from "./merges";
import type { Project } from "./project-types";

setDefaultTimeout(30_000);

const URL_ = "http://localhost:4310";

describe("merges the server runs", () => {
	let deps: Testing;
	let routes: MergeRoutes;
	let send: ServerSend;
	let worktree: string;
	beforeEach(async () => {
		deps = await Testing.open();
		// The project's own records stand in for the repository a merge opens.
		routes = new MergeRoutes(
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
		await add(deps, "alpha");
		worktree = (await deps.service.find("alpha")).path;
	});
	afterEach(() => deps.disposeAsync());

	const ask = (message = "") => ({
		task: "alpha",
		cwd: worktree,
		pid: 4242,
		hostname: "here",
		env: {},
		message,
	});

	it("lands the task a command hands it, the command printing its lines", async () => {
		await deps.commit(worktree, "alpha.txt", "alpha\n", "add alpha");
		await deps.finish(worktree);
		const log = new MemoryLogger();
		const facts: Partial<Facts["merge"]> = {};

		const outcome = await mergeOnServer(
			{ server: { url: URL_, send }, slug: "repo", log },
			ask(),
			facts,
		);

		expect(outcome).toBe("landed");
		expect(
			await deps.gitCli(deps.root, "log", "--format=%s", "-1", "main"),
		).toBe("add alpha");
		expect(facts.commit).toEqual(expect.any(String));
		expect(log.entries.length).toBeGreaterThan(0);
		expect(await deps.storage.collection("merge-queue").list()).toEqual([]);
	});

	it("refuses as its merge refused, giving the task back to the command", async () => {
		await deps.commit(worktree, "README.md", "task side\n", "task edit");
		await deps.commit(deps.root, "README.md", "trunk side\n", "trunk edit");
		await deps.finish(worktree);

		await expect(
			mergeOnServer(
				{ server: { url: URL_, send }, slug: "repo", log: new MemoryLogger() },
				ask(),
				{},
			),
		).toBail("conflict", { message: "README.md" });

		expect((await deps.service.find("alpha")).lease?.pid).toBe(4242);
	});

	it("says a server too old to run merges is unreachable, for the command to merge itself", async () => {
		const outcome = await mergeOnServer(
			{
				server: {
					url: URL_,
					send: async () => new Response("Not Found", { status: 404 }),
				},
				slug: "repo",
				log: new MemoryLogger(),
			},
			ask(),
			{},
		);

		expect(outcome).toBe("unreachable");
	});

	it("says a server it cannot reach is unreachable, for the command to merge itself", async () => {
		const outcome = await mergeOnServer(
			{
				server: {
					url: URL_,
					send: async () => {
						throw new Error("connection refused");
					},
				},
				slug: "repo",
				log: new MemoryLogger(),
			},
			ask(),
			{},
		);

		expect(outcome).toBe("unreachable");
	});
});
