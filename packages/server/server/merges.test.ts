import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	setDefaultTimeout,
} from "bun:test";
import { MemoryLogger } from "core/log";
import type { Conversation } from "../conversations";
import { mergeOnServer } from "../merge";
import type { Facts, Repository } from "../records";
import { add } from "../tasks";
import { Testing } from "../testing";
import type { TrustBand, TrustStore } from "../trust";
import type { ServerSend } from "../workers";
import { MergeRoutes, unapprovedWhy, unreviewedWhy } from "./merges";
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

describe("unapprovedWhy", () => {
	const project = {
		service: { git: { root: "/repo" }, find: async () => ({}) },
	} as unknown as Project;
	const trustAt = (band: TrustBand, score: number) =>
		({
			postureOfWork: async () => ({ band, entry: { score }, asking: [] }),
		}) as unknown as TrustStore;
	const talk = (...texts: [role: "user" | "agent", text: string][]) =>
		({
			state: {
				task: "alpha",
				agent: "claude",
				settings: [],
				messages: texts.map(([role, text]) => ({
					role,
					parts: [{ type: "text", text }],
					plan: null,
					at: null,
					until: null,
				})),
			},
		}) as unknown as Conversation;
	const plan =
		"## 📝 Plan: Limit upload size\n\n**Goal:** Uploads exhaust storage.\n**After:** Big ones are refused.\n**Approach:** Check the size.";

	it("refuses an ask-and-wait agent whose plan nobody approved", async () => {
		expect(
			await unapprovedWhy(project, trustAt("ask-and-wait", 59), [
				talk(["agent", plan]),
			]),
		).toContain("59/100");
	});

	it("lets an approved plan, or ask-and-go trust, land", async () => {
		expect(
			await unapprovedWhy(project, trustAt("ask-and-wait", 59), [
				talk(["agent", plan], ["user", "Approve & start: Limit upload size"]),
			]),
		).toBeNull();
		expect(
			await unapprovedWhy(project, trustAt("ask-and-go", 76), [
				talk(["agent", plan]),
			]),
		).toBeNull();
	});

	it("refuses at high trust when trusted decisions are paused", async () => {
		// Paused trust puts every agent in ask-and-wait, whatever its score.
		expect(
			await unapprovedWhy(project, trustAt("ask-and-wait", 95), [
				talk(["agent", plan]),
			]),
		).toContain("95/100");
	});

	it("lets a trusted agent that asked anyway land, approved or not", async () => {
		expect(
			await unapprovedWhy(project, trustAt("assume", 95), [
				talk(["agent", plan], ["user", "Approve & start: Limit upload size"]),
			]),
		).toBeNull();
		expect(
			await unapprovedWhy(project, trustAt("assume", 95), [
				talk(["agent", plan]),
			]),
		).toBeNull();
	});

	it("leaves a task no conversation works alone", async () => {
		expect(
			await unapprovedWhy(project, trustAt("ask-and-wait", 10), []),
		).toBeNull();
	});

	describe("unreviewedWhy", () => {
		it("holds a plan approved with Approve & review until a merge review is approved", () => {
			expect(
				unreviewedWhy([
					talk(
						["agent", plan],
						["user", "Approve & review: Limit upload size"],
					),
				]),
			).toContain("[SPLATES MERGE]");
			expect(
				unreviewedWhy([
					talk(
						["agent", plan],
						["user", "Approve & review: Limit upload size"],
						["agent", "## 👀 Ready to merge alpha"],
						["user", "[SPLATES MERGE]"],
					),
				]),
			).toBeNull();
		});

		it("lets a plain approval land without a review", () => {
			expect(
				unreviewedWhy([
					talk(["agent", plan], ["user", "Approve: Limit upload size"]),
				]),
			).toBeNull();
			expect(unreviewedWhy([])).toBeNull();
		});

		it("holds a One-way plan until a merge review is approved, and lets Clean revert and Revert + cleanup land", () => {
			const tagged = (undo: string) =>
				`## 📝 Plan: Drop legacy records\n\n**Goal:** Remove old rows.\n\n**Tags:**\n- ${undo}`;
			const oneWay = tagged("One-way: deleted rows cannot be recovered");
			const why = unreviewedWhy([
				talk(["agent", oneWay], ["user", "Approve: Drop legacy records"]),
			]);
			expect(why).toContain("One-way");
			expect(why).toContain("[SPLATES MERGE]");
			expect(
				unreviewedWhy([
					talk(
						["agent", oneWay],
						["user", "Approve: Drop legacy records"],
						["agent", "## 👀 Ready to merge alpha"],
						["user", "[SPLATES MERGE]"],
					),
				]),
			).toBeNull();
			expect(
				unreviewedWhy([
					talk(
						["agent", tagged("Clean revert: reverting restores it")],
						["user", "Approve: Drop legacy records"],
					),
				]),
			).toBeNull();
			expect(
				unreviewedWhy([
					talk(
						["agent", tagged("Revert + cleanup: drop the table by hand")],
						["user", "Approve: Drop legacy records"],
					),
				]),
			).toBeNull();
		});
	});
});
