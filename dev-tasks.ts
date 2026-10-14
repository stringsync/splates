import type { Conversations } from "./conversations";
import { fileResponse, MEDIA_TYPES, refuse } from "./dev-http";
import type { Project } from "./dev-project";
import type { ProjectWatch } from "./dev-project-watch";
import { fail } from "./exit";
import { remove } from "./remove";
import { grantRetry } from "./retry";
import { RECENT_COMMITS, systemsReport } from "./system-changes";
import { Systems } from "./systems";

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

	// Only a file a todo or a task holds, so the page, and whoever a tunnel
	// lets reach it, can read nothing on this machine that was not put there
	// on purpose.
	readonly file = async (request: Request): Promise<Response> => {
		const { todos, service, fs } = this.#project;
		const params = new URL(request.url).searchParams;
		const path = params.get("path") ?? "";
		const type = MEDIA_TYPES[path.split(".").at(-1)?.toLowerCase() ?? ""];
		const bytes =
			todos.owns(path) || service.owns(path)
				? await fs.readBytes(path).catch(() => null)
				: null;
		if (bytes === null) {
			return refuse(404, "not_found", `nothing here shows ${path}`);
		}
		return fileResponse(request, bytes, type, {});
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

	// Every system the tree's config names, for `#` to offer: its own
	// worktree's for a task, so one named there counts at once.
	readonly systems = async (request: Request): Promise<Response> => {
		const { service, fs } = this.#project;
		const task = new URL(request.url).searchParams.get("task") ?? "";
		const worktree = task === "" ? null : await service.find(task);
		if (worktree !== null && !worktree.exists) {
			fail("not_found", `no worktree for '${task}'`, { task });
		}
		const named = await Systems.at(worktree?.path ?? service.git.root, {
			fs,
		});
		return Response.json(named.all());
	};

	// The Systems page: what each system the main tree names holds on trunk,
	// and the commits that lately changed it.
	readonly systemChanges = async (): Promise<Response> => {
		const { service, fs } = this.#project;
		const { git, trunk } = service;
		const [named, files, commits] = await Promise.all([
			Systems.at(git.root, { fs }),
			git.files(trunk),
			git.log(trunk, RECENT_COMMITS),
		]);
		return Response.json(systemsReport(named, files, commits));
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

	// `arbor retry` from the page: another round of merge attempts for a
	// task escalated once it spent its own.
	readonly retryTask = async (request: Request): Promise<Response> => {
		const { journal, service } = this.#project;
		const task = decodeURIComponent(
			new URL(request.url).pathname.split("/")[3] ?? "",
		);
		const worktree = await journal.record("retry", task, () =>
			grantRetry(service, task),
		);
		await this.#watch.tick();
		return Response.json(worktree.state);
	};

	// `arbor remove` from the page, which asks first while an agent works on
	// the task, so it goes past an external agent's lease. Each conversation
	// in its tree stops before the tree goes, and carries on in the main tree.
	readonly removeTask = async (request: Request): Promise<Response> => {
		const { journal, service, log, todos } = this.#project;
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
		await journal.record("remove", task, () =>
			remove({ service, log, todos }, task, {
				force: true,
				conversation: on[0]?.id,
			}),
		);
		for (const conversation of on) {
			conversation.move(null, service.git.root);
		}
		await this.#watch.tick();
		return Response.json({});
	};
}
