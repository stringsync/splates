import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenPortProvider } from "webappwiz/system";
import { add } from "./add";
import { Conversations } from "./conversations";
import { dev } from "./dev";
import { serving } from "./dev-testing";
import { AGENT, FakeAgent } from "./fake-agent";
import type { Snapshot } from "./snapshot";
import type { Stats } from "./stats";
import { Testing } from "./testing";

describe("dev projects", () => {
	let deps: Testing;

	beforeEach(async () => {
		deps = await Testing.open();
	});

	afterEach(() => deps.disposeAsync());

	/** A second repository, registered after the one the server runs in. */
	const another = async () => {
		const other = await Testing.open();
		await deps.projects.register(deps.root);
		await deps.projects.register(other.root);
		return other;
	};

	const write = (port: number, path: string, method: string, body = {}) =>
		fetch(`http://127.0.0.1:${port}${path}`, {
			method,
			headers: {
				origin: `http://127.0.0.1:${port}`,
				"content-type": "application/json",
			},
			body: JSON.stringify(body),
		});

	it("serves another registered project by its slug, writes and all", async () => {
		await using other = await another();

		await serving(deps, async (snapshot, port) => {
			const form = new FormData();
			form.set("subject", "over there");
			const added = await fetch(
				`http://127.0.0.1:${port}/api/todos?project=repo-2`,
				{
					method: "POST",
					headers: { origin: `http://127.0.0.1:${port}` },
					body: form,
				},
			);
			expect(added.status).toBe(200);

			const there = (await (
				await fetch(`http://localhost:${port}/api/snapshot?project=repo-2`)
			).json()) as Snapshot;
			expect(there.path).toBe(other.root);
			expect(there.todos.map((todo) => todo.subject)).toEqual(["over there"]);
			expect((await snapshot()).todos).toEqual([]);
			expect((await other.todos.all()).map((todo) => todo.subject)).toEqual([
				"over there",
			]);
		});
	});

	it("starts with no project, then shows the one last focused for an address naming none", async () => {
		await deps.projects.forget(deps.root);

		await serving(deps, async (snapshot, port) => {
			expect(
				(await fetch(`http://localhost:${port}/api/snapshot`)).status,
			).toBe(404);

			await using other = await another();
			await other.todos.add("over there", null);
			expect((await snapshot()).todos).toEqual([]);

			const focused = await write(port, "/api/focus", "PUT", {
				project: "repo-2",
			});
			expect(focused.status).toBe(200);
			expect((await snapshot()).todos.map((todo) => todo.subject)).toEqual([
				"over there",
			]);
			expect(
				(await write(port, "/api/focus", "PUT", { project: "none" })).status,
			).toBe(404);
		});
	});

	it("adds a repository by its path, as `arbor init` there would, and commits what it wrote once asked", async () => {
		await deps.projects.forget(deps.root);
		// A `bunx` that writes what `skills add` would, off the network.
		const bin = join(deps.arborHome, "..", "bin");
		await deps.fs.mkdir(bin);
		await deps.fs.write(
			join(bin, "bunx"),
			"#!/bin/sh\nmkdir -p .agents/skills/arbor\necho skill > .agents/skills/arbor/SKILL.md\necho {} > skills-lock.json\n",
		);
		await chmod(join(bin, "bunx"), 0o755);
		deps.proc.env = { ...deps.proc.env, PATH: `${bin}:${process.env.PATH}` };
		await using fresh = await Testing.open({ init: false });
		await fresh.fs.write(join(fresh.root, "notes.txt"), "mine\n");
		// Untracked in a directory the skill's link shares: never offered.
		await fresh.fs.mkdir(join(fresh.root, ".claude"));
		await fresh.fs.write(join(fresh.root, ".claude", "notes.md"), "{}\n");
		await fresh.fs.mkdir(join(fresh.root, "sub"));

		await serving(deps, async (snapshot, port) => {
			const refused = await write(port, "/api/projects", "POST", {
				path: tmpdir(),
			});
			expect(refused.status).toBe(400);
			expect(await refused.json()).toMatchObject({
				message: expect.stringContaining("not in a git repository"),
			});

			const add = async () =>
				(await (
					await write(port, "/api/projects", "POST", {
						path: join(fresh.root, "sub"),
					})
				).json()) as {
					project: { slug: string; root: string };
					uncommitted: string[];
					shown: string[];
					branch: string | null;
				};
			const body = await add();
			expect(body).toMatchObject({
				project: { root: fresh.root },
				uncommitted: [".agents/skills/arbor/SKILL.md", "skills-lock.json"],
				shown: [".agents/skills/arbor", "skills-lock.json"],
				branch: "main",
			});
			// Added again before committing, it offers them again.
			expect((await add()).uncommitted).toEqual(body.uncommitted);
			expect(await fresh.format.check()).toBeUndefined();
			// Focused, so an address naming none shows it.
			await fresh.todos.add("fresh", null);
			expect((await snapshot()).todos.map((todo) => todo.subject)).toEqual([
				"fresh",
			]);

			const committed = await write(
				port,
				`/api/projects/${body.project.slug}/commit`,
				"POST",
				{ paths: body.uncommitted },
			);
			expect(committed.status).toBe(200);
			expect(await fresh.gitCli(fresh.root, "log", "-1", "--format=%s")).toBe(
				"Set up arbor",
			);
			expect(
				await fresh.gitCli(fresh.root, "status", "--porcelain", "-uall"),
			).toBe("?? .claude/notes.md\n?? notes.txt");
		});
	}, 15_000);

	it("lists the projects, and forgets any not under way", async () => {
		await using other = await another();
		await deps.projects.register("/nowhere/gone");

		await serving(deps, async (_, port) => {
			const list = async () =>
				(
					(await (
						await fetch(`http://localhost:${port}/api/projects`)
					).json()) as {
						projects: { slug: string; root: string; gone: boolean }[];
					}
				).projects;
			expect(await list()).toMatchObject([
				{ slug: "repo", gone: false },
				{ slug: "repo-2", gone: false },
				{ slug: "gone", gone: true },
			]);
			expect(
				(await fetch(`http://localhost:${port}/api/snapshot?project=gone`))
					.status,
			).toBe(404);
			expect(
				(await fetch(`http://localhost:${port}/api/snapshot?project=none`))
					.status,
			).toBe(404);

			expect((await write(port, "/api/projects/gone", "DELETE")).status).toBe(
				200,
			);
			// Focused, so a page showing it goes on to the one left.
			await deps.projects.focus(deps.root);
			const forgot = await write(port, "/api/projects/repo", "DELETE");
			// The one left takes the name the forgotten one had.
			expect(await forgot.json()).toMatchObject({
				root: deps.root,
				next: { slug: "repo", root: other.root },
			});
			expect(await list()).toMatchObject([{ slug: "repo", root: other.root }]);
		});
	});

	it("sums how tasks ended in every project, opened or not", async () => {
		await using other = await another();
		// As the CLI writes it there, into the home the server shares.
		await deps.outcomes.record({
			project: other.root,
			task: "there",
			base: "main",
			ended: "removed",
			startedAt: "2026-10-14T09:00:00.000Z",
			endedAt: new Date().toISOString(),
			questionRounds: 1,
			reviewRounds: 0,
			failedMerges: 0,
			conversation: null,
			agent: null,
			model: null,
		});

		await serving(deps, async (_, port) => {
			const stats = (await (
				await fetch(`http://localhost:${port}/api/stats`)
			).json()) as Stats;
			expect(stats.projects).toMatchObject([
				{ project: other.root, removed: 1, questionRounds: 1 },
			]);
			expect(
				(await fetch(`http://localhost:${port}/api/stats?period=soon`)).status,
			).toBe(400);
		});
	});

	it("counts the agents waiting on the person in each project, opened or not", async () => {
		await using other = await another();
		const escalate = async (project: typeof other, task: string) => {
			await add(project, task);
			await (await project.service.find(task)).save({
				status: "escalated",
				escalations: [
					{ reason: "needs a human", at: new Date().toISOString() },
				],
			});
		};
		await escalate(other, "beta");
		await escalate(other, "gamma");
		await add(other, "delta");

		await serving(deps, async (_, port) => {
			const waiting = async () =>
				(
					(await (
						await fetch(`http://localhost:${port}/api/projects`)
					).json()) as { projects: { slug: string; waiting: number }[] }
				).projects.map(({ slug, waiting }) => [slug, waiting]);
			expect(await waiting()).toEqual([
				["repo", 0],
				["repo-2", 2],
			]);

			await escalate(deps, "alpha");
			expect(await waiting()).toEqual([
				["repo", 1],
				["repo-2", 2],
			]);
		});
	}, 15_000);

	it("finds a conversation by its id in the project it started in", async () => {
		await using other = await another();
		const agent = new FakeAgent();
		const server = await dev(deps, {
			ports: OpenPortProvider.any(),
			conversations: ({ arborDir }) =>
				new Conversations(`${arborDir}/conversations`, [AGENT], {
					launch: agent.launch,
				}),
		});
		try {
			const { port } = server;
			const started = await write(
				port,
				"/api/conversations?project=repo-2",
				"POST",
				{ agent: "fake" },
			);
			const { id } = (await started.json()) as { id: string };
			expect(agent.launched[0]?.cwd).toBe(other.root);

			// As the agent's own `arbor` would, naming no project.
			const renamed = await write(
				port,
				`/api/conversations/${id}/name`,
				"PUT",
				{
					name: "Elsewhere",
				},
			);
			expect(await renamed.json()).toMatchObject({ id, name: "Elsewhere" });
			const listed = async (query: string) =>
				(
					(await (
						await fetch(`http://localhost:${port}/api/conversations${query}`)
					).json()) as { conversations: { id: string }[] }
				).conversations.map((each) => each.id);
			expect(await listed("?project=repo-2")).toEqual([id]);
			expect(await listed("")).toEqual([]);
		} finally {
			await server.disposeAsync();
		}
	}, 15_000);

	it("refuses to forget a project with a conversation under way", async () => {
		await using _other = await another();
		const server = await dev(deps, {
			ports: OpenPortProvider.any(),
			conversations: ({ arborDir }) =>
				new Conversations(`${arborDir}/conversations`, [AGENT], {
					launch: new FakeAgent().launch,
				}),
		});
		try {
			const { port } = server;
			await write(port, "/api/conversations?project=repo-2", "POST", {
				agent: "fake",
			});

			const refused = await write(port, "/api/projects/repo-2", "DELETE");
			expect(refused.status).toBe(400);
			expect(await refused.json()).toMatchObject({
				message: expect.stringContaining("stop fake first"),
			});
			expect((await deps.projects.list()).map((each) => each.slug)).toEqual([
				"repo",
				"repo-2",
			]);
		} finally {
			await server.disposeAsync();
		}
	}, 15_000);
});
