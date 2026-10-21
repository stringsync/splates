// scry-ignore-file doc-comments-address-users: its imports moved to server/; it predates the rule
import { movedPath } from "../config";
import type { Conversations } from "../conversations";
import { fail } from "../exit";
import { TaskBranches } from "../merge";
import type { Project, ProjectWatch } from "../server/shared";
import { fileResponse, MEDIA_TYPES, refuse } from "../server/shared";
import { editorOf } from "./editors";
import { inTree } from "./open";
import { remove } from "./remove";
import { grantRetry } from "./retry";

/**
 * What a project's page reads of its tasks, and what it does to them. Each
 * handler is a property, so `serveProject` spreads them into the project's
 * routes; what they work on stays private, out of the spread.
 */
export class TaskRoutes {
	readonly #project: Project;
	readonly #conversations: Conversations | null;
	readonly #watch: ProjectWatch;

	constructor(
		project: Project,
		conversations: Conversations | null,
		watch: ProjectWatch,
	) {
		this.#project = project;
		this.#conversations = conversations;
		this.#watch = watch;
	}

	// Only a file a queued or started task holds, or one kept with a finished
	// task's plan, so the page, and whoever a tunnel lets reach it, can read
	// nothing on this machine that was not put there on purpose.
	readonly file = async (request: Request): Promise<Response> => {
		const { tasks: queue, service, fs } = this.#project;
		const params = new URL(request.url).searchParams;
		const path = movedPath(params.get("path") ?? "");
		const type = MEDIA_TYPES[path.split(".").at(-1)?.toLowerCase() ?? ""];
		const bytes =
			queue.owns(path) || service.owns(path) || service.finished.owns(path)
				? await fs.readBytes(path).catch(() => null)
				: null;
		if (bytes === null) {
			return refuse(404, "not_found", `nothing here shows ${path}`);
		}
		return fileResponse(request, bytes, type, {});
	};

	// A file the page names, in the person's editor inside the tree it belongs
	// to, which a link cannot say. Only a file under this project's trees, so
	// the page can open nothing else on this machine.
	readonly open = async (request: Request): Promise<Response> => {
		const { service, fs, ps } = this.#project;
		const body = (await request.json().catch(() => ({}))) as {
			editor?: unknown;
			path?: unknown;
			line?: unknown;
		};
		const editor = editorOf(String(body.editor));
		if (editor === null) {
			return refuse(400, "usage", `no editor '${String(body.editor)}'`);
		}
		const path = typeof body.path === "string" ? body.path : "";
		const line = Number.isInteger(body.line) ? Number(body.line) : null;
		const found = path.startsWith("/")
			? await inTree(
					path,
					{ root: service.git.root, worktrees: service.config.worktreeRoot },
					(tree) => fs.exists(tree),
				)
			: null;
		if (found === null) {
			return refuse(
				404,
				"not_found",
				`${path} is in none of this project's trees`,
			);
		}
		const argv = editor.argv(found.tree, found.file, line);
		const { exitCode } = await ps
			.spawnCapture(argv)
			.catch(() => ({ exitCode: null }));
		if (exitCode !== 0) {
			return refuse(
				503,
				"no_editor",
				`\`${argv[0]}\` did not open ${found.file}: is its command installed?`,
			);
		}
		return new Response(null, { status: 204 });
	};

	// Names only, and only what git would show anyone with the repo: enough to
	// point an agent at a file with `@`, and nothing inside one.
	readonly paths = async (request: Request): Promise<Response> => {
		const { service } = this.#project;
		const task = new URL(request.url).searchParams.get("task") ?? "";
		const worktree = task === "" ? null : await service.find(task);
		if (worktree !== null && !worktree.exists) {
			fail("not_found", `no worktree for '${task}'`, { task });
		}
		return Response.json(
			await service.git.paths(worktree?.path ?? service.git.root),
		);
	};

	// Every task that merged or was removed here, newest first, for the Tasks
	// page to look back on.
	readonly finishedTasks = async (): Promise<Response> =>
		Response.json(await this.#project.service.finished.list());

	// One finished task with the SPLATES.md it ended on.
	readonly finishedTask = async (request: Request): Promise<Response> => {
		const key = decodeURIComponent(
			new URL(request.url).pathname.split("/")[3] ?? "",
		);
		const found = await this.#project.service.finished.read(key);
		if (found === null) {
			return refuse(404, "not_found", `no finished task ${key}`);
		}
		return Response.json(found);
	};

	// What a task changed against its base, for its review in the page.
	readonly diff = async (request: Request): Promise<Response> => {
		const task = decodeURIComponent(
			new URL(request.url).pathname.split("/")[3] ?? "",
		);
		const worktree = await this.#project.service.find(task);
		const files = worktree.hasBranch ? await worktree.diff() : null;
		if (files === null) {
			fail("not_found", `no branch for '${task}'`, { task });
		}
		return Response.json(files);
	};

	// `splates retry` from the page: another round of merge attempts for a
	// task that spent its own.
	readonly retryTask = async (request: Request): Promise<Response> => {
		const { journal, service } = this.#project;
		const task = decodeURIComponent(
			new URL(request.url).pathname.split("/")[3] ?? "",
		);
		const { worktree } = await journal.record(
			"retry",
			task,
			() => grantRetry(service, task),
			({ attempts }) => ({ attempts }),
		);
		this.#watch.tick();
		return Response.json(worktree.state);
	};

	// `splates remove` from the page, which asks first while an agent works on
	// the task, so it goes past an external agent's lease. Each conversation
	// in its tree stops before the tree goes, and carries on in the main tree.
	readonly removeTask = async (request: Request): Promise<Response> => {
		const { journal, service, log, tasks: queue, slots, creds } = this.#project;
		const task = decodeURIComponent(
			new URL(request.url).pathname.split("/")[3] ?? "",
		);
		const on = (await (this.#conversations?.list() ?? [])).filter(
			(each) => each.state.task === task,
		);
		for (const conversation of on) {
			await conversation.cancel();
			await conversation.stop();
		}
		await journal.record(
			"remove",
			task,
			() =>
				remove(
					{
						service,
						log,
						tasks: queue,
						slots,
						branches: TaskBranches.of({
							git: service.git,
							config: service.config,
							creds,
						}),
					},
					task,
					{ force: true, conversation: on[0]?.id },
				),
			({ released }) => ({ why: null, released }),
		);
		for (const conversation of on) {
			conversation.move(null, service.git.root);
		}
		this.#watch.tick();
		return Response.json({});
	};
}
