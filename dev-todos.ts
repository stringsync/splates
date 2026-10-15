import type { ConversationRoutes } from "./dev-conversation-routes";
import { body, uploads } from "./dev-http";
import type { Project } from "./dev-project";
import type { ProjectWatch } from "./dev-project-watch";
import { fail } from "./exit";
import { laneUpdated, recordLaneRemove } from "./lane";
import { type AgentPick, modelsOf, pickAgent } from "./roster";
import { recordUpdate } from "./todo";
import { addedFacts } from "./todo-edit";

/**
 * How a project's page writes its todos and lanes, each write journaled and
 * read back for the pages listening. Each handler is a property, so
 * `serveProject` spreads them into the project's routes; what they work on
 * stays private, out of the spread.
 */
export class TodoRoutes {
	readonly #project: Project;
	readonly #conversations: ConversationRoutes;
	readonly #watch: ProjectWatch;

	constructor(
		project: Project,
		conversations: ConversationRoutes,
		watch: ProjectWatch,
	) {
		this.#project = project;
		this.#conversations = conversations;
		this.#watch = watch;
	}

	readonly addTodo = async (request: Request): Promise<Response> => {
		const { journal, todos } = this.#project;
		const form = await request.formData();
		const todo = await journal.record(
			"todo add",
			null,
			async () =>
				todos.add(String(form.get("subject") ?? ""), null, {
					text: String(form.get("text") ?? ""),
					files: await uploads(form),
					position: positionIn(form),
					// Added from a lane's column, it goes at the bottom of that lane.
					lane: form.has("lane") ? laneIn(Number(form.get("lane"))) : null,
				}),
			addedFacts,
		);
		await this.#watch.tick();
		return Response.json(todo.state);
	};

	readonly updateTodo = async (request: Request): Promise<Response> => {
		const form = await request.formData();
		const found = await this.todoAt(request);
		const todo = await recordUpdate(
			this.#project.journal,
			this.#project.todos,
			found.id,
			async () =>
				found.update({
					subject: form.has("subject")
						? String(form.get("subject"))
						: undefined,
					text: form.has("text") ? String(form.get("text")) : undefined,
					position: positionIn(form),
					files: await uploads(form),
					keep: form.getAll("keep").map(String),
				}),
		);
		await this.#watch.tick();
		return Response.json(todo.state);
	};

	// Its own route, carrying nothing but the place, so a drag can never touch
	// a todo's words or files.
	readonly moveTodo = async (request: Request): Promise<Response> => {
		const found = await this.todoAt(request);
		const { position } = (await request.json()) as { position?: unknown };
		const todo = await recordUpdate(
			this.#project.journal,
			this.#project.todos,
			found.id,
			() => found.update({ position: Number(position) }),
		);
		await this.#watch.tick();
		return Response.json(todo.state);
	};

	// What blocks it, all of it: the page sends the whole list, and
	// only the difference is linked or unlinked, so a loop is still refused.
	readonly linkTodo = async (request: Request): Promise<Response> => {
		const { journal, todos } = this.#project;
		const found = await this.todoAt(request);
		const { blockedBy } = await body(request);
		const ids = Array.isArray(blockedBy) ? blockedBy.map(Number) : [];
		const todo = await recordUpdate(journal, todos, found.id, () =>
			todos.link(found.id, {
				add: ids.filter((id) => !found.blockedBy.includes(id)),
				drop: found.blockedBy.filter((id) => !ids.includes(id)),
			}),
		);
		await this.#watch.tick();
		return Response.json(todo.state);
	};

	// Into a lane, or none, above the todo `before` or at the bottom of it.
	readonly arrangeTodo = async (request: Request): Promise<Response> => {
		const { journal, todos } = this.#project;
		const found = await this.todoAt(request);
		const { lane, before, name } = await body(request);
		const todo = await recordUpdate(journal, todos, found.id, () =>
			todos.arrange(found.id, laneIn(lane), {
				name: typeof name === "string" ? name : undefined,
				before:
					before === undefined || before === null ? undefined : Number(before),
			}),
		);
		await this.#watch.tick();
		return Response.json(todo.state);
	};

	readonly joinLane = async (request: Request): Promise<Response> => {
		const { journal, todos } = this.#project;
		const from = laneAt(request);
		const { into } = await body(request);
		await journal.record("lane join", null, () =>
			todos.joinLanes(from, Number(into)),
		);
		await this.#watch.tick();
		return Response.json({ lane: Number(into) });
	};

	readonly addLane = async (request: Request): Promise<Response> => {
		const { journal, todos } = this.#project;
		const { name } = await body(request);
		const lane = await journal.record(
			"lane add",
			null,
			() => todos.addLane(String(name ?? "")),
			(added) => ({ lane: added.id, name: added.name }),
		);
		await this.#watch.tick();
		return Response.json(lane);
	};

	// A new name, a new place among the lanes, or both.
	readonly updateLane = async (request: Request): Promise<Response> => {
		const { journal, todos } = this.#project;
		const id = laneAt(request);
		const { name, position } = await body(request);
		const change = {
			name: name === undefined ? undefined : String(name),
			position: position === undefined ? undefined : Number(position),
		};
		const lane = await journal.record(
			"lane update",
			null,
			async () => {
				const renamed =
					change.name === undefined
						? undefined
						: await todos.renameLane(id, change.name);
				const order =
					change.position === undefined
						? undefined
						: await todos.moveLane(id, change.position);
				return order?.find((each) => each.id === id) ?? renamed;
			},
			(record) => laneUpdated(id, record ?? { id, name: "" }, change),
		);
		await this.#watch.tick();
		return Response.json(lane ?? { id });
	};

	readonly assignTodo = async (request: Request): Promise<Response> => {
		const found = await this.todoAt(request);
		const assignee = await this.assigneeIn(request);
		const todo = await recordUpdate(
			this.#project.journal,
			this.#project.todos,
			found.id,
			() => found.update({ assignee }),
		);
		await this.#watch.tick();
		return Response.json(todo.state);
	};

	readonly dropLane = async (request: Request): Promise<Response> => {
		const { journal, todos } = this.#project;
		const id = laneAt(request);
		await recordLaneRemove(journal, todos, id, () => todos.dropLane(id));
		await this.#watch.tick();
		return Response.json({ lane: id });
	};

	readonly removeTodo = async (request: Request): Promise<Response> => {
		const found = await this.todoAt(request);
		await this.#project.journal.record("todo remove", null, () =>
			found.remove(),
		);
		await this.#watch.tick();
		return Response.json(found.state);
	};

	/** The todo a `/api/todos/<id>` path names, or `/api/todos/<id>/position`. */
	private async todoAt(request: Request) {
		const raw = new URL(request.url).pathname.split("/")[3] ?? "";
		const id = Number(raw);
		if (!Number.isInteger(id) || id <= 0) {
			fail("usage", `'${raw}' is not a todo id`, { todo: raw });
		}
		return this.#project.todos.find(id);
	}

	/**
	 * The agent a body names, `{ agent, model }`, off the roster the page's
	 * conversations start from; null for `{ agent: null }`, for none.
	 */
	private async assigneeIn(request: Request): Promise<AgentPick | null> {
		const { agent, model } = await body(request);
		if (agent === null || agent === undefined || agent === "") {
			return null;
		}
		return pickAgent(
			this.#conversations
				.held()
				.agents.map((each) => ({ ...each, models: modelsOf(each) })),
			String(agent),
			model === null || model === undefined || model === ""
				? undefined
				: String(model),
		);
	}
}

/** Where a todo write asks to put it; absent leaves it to the write. */
function positionIn(form: FormData): number | undefined {
	return form.has("position") ? Number(form.get("position")) : undefined;
}

/** A lane as a write names it: a number, `"new"`, or null for none. */
function laneIn(value: unknown): number | "new" | null {
	return value === "new" || value === null ? value : Number(value);
}

/** The lane a `/api/lanes/<id>` path names. */
function laneAt(request: Request): number {
	const raw = new URL(request.url).pathname.split("/")[3] ?? "";
	const id = Number(raw);
	if (!Number.isInteger(id) || id <= 0) {
		fail("usage", `'${raw}' is not a lane`, { lane: raw });
	}
	return id;
}
