import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { OpenPortProvider } from "webappwiz/system";
import { add } from "./add";
import { Conversations } from "./conversations";
import { dev } from "./dev";
import { serving } from "./dev-testing";
import { AGENT, FakeAgent } from "./fake-agent";
import type { Snapshot } from "./snapshot";
import { Testing } from "./testing";

describe("dev", () => {
	let deps: Testing;

	beforeEach(async () => {
		deps = await Testing.open();
	});

	afterEach(() => deps.disposeAsync());

	describe("projects", () => {
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

		it("refuses to start in a project `arbor init` never registered", async () => {
			await deps.projects.forget(deps.root);

			await expect(dev(deps, { ports: OpenPortProvider.any() })).toBail(
				"uninitialized",
				{ message: "Run `arbor init` in it once" },
			);
		});

		it("lists the projects, and forgets a gone one but never its own", async () => {
			await using _other = await another();
			await deps.projects.register("/nowhere/gone");

			await serving(deps, async (_, port) => {
				const list = async () =>
					(
						(await (
							await fetch(`http://localhost:${port}/api/projects`)
						).json()) as {
							projects: { slug: string; gone: boolean; here: boolean }[];
						}
					).projects;
				expect(await list()).toMatchObject([
					{ slug: "repo", gone: false, here: true },
					{ slug: "repo-2", gone: false, here: false },
					{ slug: "gone", gone: true, here: false },
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
				expect((await write(port, "/api/projects/repo", "DELETE")).status).toBe(
					400,
				);
				expect((await list()).map((each) => each.slug)).toEqual([
					"repo",
					"repo-2",
				]);
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
		});

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
});
