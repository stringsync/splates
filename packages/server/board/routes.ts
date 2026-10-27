import type { ConversationRoutes } from "../conversations";
import { fail } from "../exit";
import { type AgentPick, modelsOf, pickAgent, pickEffort } from "../models";
import { QueueMoves, queueAdd, queueRemove } from "../queue";
import type { Project, ProjectWatch } from "../server/shared";
import { body, uploads } from "../server/shared";
import { protectBacklog } from "./backlog";
import {
	type ElsewhereBlocker,
	type ElsewhereBoards,
	sameBlocker,
} from "./elsewhere";
import { laneRemove, laneUpdated, recordLaneRemove } from "./lane";
import { tasksNamed } from "./task";
import { addedFacts } from "./task-edit";
import { recordUpdate } from "./task-journal";

/**
 * Answers the page's requests to add, edit, queue and remove a project's
 * tasks and lanes.
 */
export class BoardRoutes {
	// Each handler is a property, so `serveProject` spreads them into the
	// project's routes; each write is journaled and ticks the watch, so pages
	// listening read it back.
	readonly #project: Project;
	readonly #conversations: ConversationRoutes;
	readonly #watch: ProjectWatch;
	readonly #boards: ElsewhereBoards | undefined;
	readonly #root: string;

	constructor(
		project: Project,
		conversations: ConversationRoutes,
		watch: ProjectWatch,
		elsewhere: { boards?: ElsewhereBoards; root: string },
	) {
		this.#boards = elsewhere.boards;
		this.#root = elsewhere.root;
		this.#project = project;
		this.#conversations = conversations;
		this.#watch = watch;
	}

	readonly addQueued = async (request: Request): Promise<Response> => {
		const { journal, tasks } = this.#project;
		const form = await request.formData();
		const task = await journal.record(
			"task add",
			null,
			async () =>
				tasks.add(String(form.get("subject") ?? ""), null, {
					slug: slugIn(form),
					text: String(form.get("text") ?? ""),
					files: await uploads(form),
					position: positionIn(form),
					// Added from a lane's column, it goes at the bottom of that lane.
					lane: form.has("lane") ? laneIn(Number(form.get("lane"))) : null,
				}),
			addedFacts,
		);
		this.#watch.tick();
		return Response.json(task.state);
	};

	readonly updateQueued = async (request: Request): Promise<Response> => {
		const form = await request.formData();
		const found = await this.taskAt(request);
		const task = await recordUpdate(
			this.#project.journal,
			this.#project.tasks,
			found.id,
			async () =>
				found.update({
					subject: form.has("subject")
						? String(form.get("subject"))
						: undefined,
					text: form.has("text") ? String(form.get("text")) : undefined,
					slug: slugIn(form),
					position: positionIn(form),
					files: await uploads(form),
					keep: form.getAll("keep").map(String),
				}),
		);
		this.#watch.tick();
		return Response.json(task.state);
	};

	// Its own route, carrying nothing but the place, so a drag can never touch
	// a task's words or files.
	readonly moveQueued = async (request: Request): Promise<Response> => {
		const found = await this.taskAt(request);
		const { position } = (await request.json()) as { position?: unknown };
		const task = await recordUpdate(
			this.#project.journal,
			this.#project.tasks,
			found.id,
			() => found.update({ position: Number(position) }),
		);
		this.#watch.tick();
		return Response.json(task.state);
	};

	// What blocks it, all of it: the page sends the whole list, and
	// only the difference is linked or unlinked, so a loop is still refused.
	// A blocker removed without merging stays while the list names it, and
	// is let go of once it does not.
	readonly linkQueued = async (request: Request): Promise<Response> => {
		const { journal, tasks } = this.#project;
		const found = await this.taskAt(request);
		const { blockedBy, blockedElsewhere } = await body(request);
		const ids = Array.isArray(blockedBy) ? blockedBy.map(Number) : [];
		const lost = (found.state.blockersLost ?? []).map((gone) => gone.id);
		const task = await recordUpdate(journal, tasks, found.id, async () => {
			const linked = await tasks.link(found.id, {
				add: ids.filter(
					(id) => !found.blockedBy.includes(id) && !lost.includes(id),
				),
				drop: [...found.blockedBy, ...lost].filter((id) => !ids.includes(id)),
			});
			if (!Array.isArray(blockedElsewhere)) {
				return linked;
			}
			// Those already linked stay while named; any other it names is
			// read from its project's board, which has to hold it open.
			const kept = linked.blockedElsewhere.filter((blocker) =>
				blockedElsewhere.some((named) => sameBlocker(named, blocker)),
			);
			const added: ElsewhereBlocker[] = [];
			for (const named of blockedElsewhere as ElsewhereBlocker[]) {
				if (!kept.some((blocker) => sameBlocker(named, blocker))) {
					added.push(await this.openElsewhere(named));
				}
			}
			return linked.update({ blockedElsewhere: [...kept, ...added] });
		});
		this.#watch.tick();
		return Response.json(task.state);
	};

	// The open tasks of the other projects, to pick a blocker from.
	readonly elsewhereTasks = async (): Promise<Response> =>
		Response.json(
			(await this.#boards?.openTasks(this.#root).catch(() => [])) ?? [],
		);

	/** `named` as its project's board holds it, or refuses one that is gone. */
	private async openElsewhere(named: {
		project?: unknown;
		id?: unknown;
	}): Promise<ElsewhereBlocker> {
		const project = String(named.project ?? "");
		const id = Number(named.id);
		const found =
			this.#boards === undefined || project === this.#root
				? null
				: await this.#boards.find(project, id).catch(() => null);
		if (found === null || found.status === "merged") {
			fail("not_found", `no open task #${id} in ${project}`, { project, id });
		}
		if (found.status === "removed") {
			fail("not_found", `#${id} in ${project} was removed`, { project, id });
		}
		return { project, id, subject: found.subject };
	}

	// Into a lane, or none, above the task `before` or at the bottom of it.
	readonly arrangeQueued = async (request: Request): Promise<Response> => {
		const { journal, tasks } = this.#project;
		const found = await this.taskAt(request);
		const { lane, before, name } = await body(request);
		const task = await recordUpdate(journal, tasks, found.id, () =>
			tasks.arrange(found.id, laneIn(lane), {
				name: typeof name === "string" ? name : undefined,
				before:
					before === undefined || before === null ? undefined : Number(before),
			}),
		);
		this.#watch.tick();
		return Response.json(task.state);
	};

	readonly joinLane = async (request: Request): Promise<Response> => {
		const { journal, tasks } = this.#project;
		const from = laneAt(request);
		const { into } = await body(request);
		await journal.record("lane join", null, () =>
			tasks.joinLanes(from, Number(into)),
		);
		this.#watch.tick();
		return Response.json({ lane: Number(into) });
	};

	readonly addLane = async (request: Request): Promise<Response> => {
		const { journal, tasks } = this.#project;
		const { name } = await body(request);
		const lane = await journal.record(
			"lane add",
			null,
			() => tasks.addLane(String(name ?? "")),
			(added) => ({ lane: added.id, name: added.name }),
		);
		this.#watch.tick();
		return Response.json(lane);
	};

	// A new name, a new place among the lanes, queued whole or not, or more than one.
	readonly updateLane = async (request: Request): Promise<Response> => {
		const { journal, tasks } = this.#project;
		const id = laneAt(request);
		const { name, position, queued, approve } = await body(request);
		const change = {
			name: name === undefined ? undefined : String(name),
			position: position === undefined ? undefined : Number(position),
			queued: queued === undefined ? undefined : queued === true,
			approve: approve === undefined ? undefined : Number(approve),
		};
		const lane = await journal.record(
			"lane update",
			null,
			async () => (await tasks.changeLane(id, change)).record,
			(record) => laneUpdated(id, record ?? { id, name: "" }, change),
		);
		this.#watch.tick();
		return Response.json(lane ?? { id });
	};

	readonly assignQueued = async (request: Request): Promise<Response> => {
		const found = await this.taskAt(request);
		const assignee = await this.assigneeIn(request);
		const task = await recordUpdate(
			this.#project.journal,
			this.#project.tasks,
			found.id,
			() => found.update({ assignee }),
		);
		this.#watch.tick();
		return Response.json(task.state);
	};

	/**
	 * Sets whether only the person may queue the task: send `{manual: true}`
	 * to keep queued lanes from queueing it, or `false` to let them.
	 */
	readonly manualQueued = async (request: Request): Promise<Response> => {
		const found = await this.taskAt(request);
		const { manual } = (await request.json()) as { manual?: unknown };
		if (typeof manual !== "boolean") {
			fail(
				"usage",
				"say whether only you queue it, as `manual: true` or `false`",
			);
		}
		const task = await recordUpdate(
			this.#project.journal,
			this.#project.tasks,
			found.id,
			() => found.update({ manual }),
		);
		this.#watch.tick();
		return Response.json(task.state);
	};

	/**
	 * Puts the task in the queue, `{queued: true}`, or takes it out, as
	 * `splates queue add` and `remove` do.
	 */
	readonly queueQueued = async (request: Request): Promise<Response> => {
		const found = await this.taskAt(request);
		const { queued } = (await request.json()) as { queued?: unknown };
		if (typeof queued !== "boolean") {
			fail("usage", "say whether to queue it, as `queued: true` or `false`");
		}
		const deps = { tasks: this.#project.tasks, log: this.#project.log };
		const [task] = await this.#project.journal.record(
			queued ? "queue add" : "queue remove",
			null,
			() => (queued ? queueAdd : queueRemove)(deps, [found.id]),
			(changed) => ({ tasks: tasksNamed(changed) }),
		);
		this.#watch.tick();
		return Response.json(task?.state ?? found.state);
	};

	/**
	 * Records the person's answer, `{answer}`, to question `{index}` of the
	 * task's deferral, which adds it to the task's detail.
	 */
	readonly answerDeferred = async (request: Request): Promise<Response> => {
		const { journal, tasks } = this.#project;
		const found = await this.taskAt(request);
		const { index, answer } = await body(request);
		if (
			typeof index !== "number" ||
			typeof answer !== "string" ||
			!answer.trim()
		) {
			fail(
				"usage",
				"say which question and the answer, as `index` and `answer`",
			);
		}
		const task = await recordUpdate(journal, tasks, found.id, () =>
			found.answer(index, answer),
		);
		this.#watch.tick();
		return Response.json(task.state);
	};

	/** Marks what the task's deferral waits on outside splates, `{index}`, as done. */
	readonly doneOutside = async (request: Request): Promise<Response> => {
		const { journal, tasks } = this.#project;
		const found = await this.taskAt(request);
		const { index } = await body(request);
		if (typeof index !== "number") {
			fail("usage", "say which blocker is done, as `index`");
		}
		const task = await recordUpdate(journal, tasks, found.id, () =>
			found.outsideDone(index),
		);
		this.#watch.tick();
		return Response.json(task.state);
	};

	/** Moves a queued task to `{position}` in the queue, from 1 for the next to start. */
	readonly moveInQueue = async (request: Request): Promise<Response> => {
		const found = await this.taskAt(request);
		const { position } = (await request.json()) as { position?: unknown };
		if (typeof position !== "number") {
			fail("usage", "say where in the queue, as `position`, from 1");
		}
		await new QueueMoves(this.#project.tasks).move(found.id, position);
		this.#watch.tick();
		return Response.json((await this.#project.tasks.find(found.id)).state);
	};

	/** Removes a lane with the tasks in it, which can be put back. */
	readonly dropLane = async (request: Request): Promise<Response> => {
		// Each task is kept as removing it from its dialog keeps it: the person
		// never wants a lane gone but its tasks left.
		const { journal, tasks } = this.#project;
		const id = laneAt(request);
		protectBacklog(id);
		await recordLaneRemove(journal, tasks, id, () =>
			laneRemove({ tasks, log: this.#project.log }, id),
		);
		this.#watch.tick();
		return Response.json({ lane: id });
	};

	readonly removeQueued = async (request: Request): Promise<Response> => {
		const found = await this.taskAt(request);
		await this.#project.journal.record(
			"task remove",
			null,
			// Kept, so the conversation line it was added on can put it back.
			() => found.discard(),
			() => ({ tasks: tasksNamed([found]) }),
		);
		this.#watch.tick();
		return Response.json(found.state);
	};

	/** Puts back a task the page removed, under its id, where it stood. */
	readonly restoreQueued = async (request: Request): Promise<Response> => {
		const { journal, tasks } = this.#project;
		const task = await journal.record(
			"task add",
			null,
			() => tasks.restore(this.idAt(request)),
			addedFacts,
		);
		this.#watch.tick();
		return Response.json(task.state);
	};

	/** The task a `/api/todos/<id>` path names, or `/api/todos/<id>/position`. */
	private async taskAt(request: Request) {
		return this.#project.tasks.find(this.idAt(request));
	}

	/** The id a `/api/todos/<id>` path names, or `/api/todos/<id>/restore`. */
	private idAt(request: Request): number {
		const raw = new URL(request.url).pathname.split("/")[3] ?? "";
		const id = Number(raw);
		if (!Number.isInteger(id) || id <= 0) {
			fail("usage", `'${raw}' is not a task id`, { number: raw });
		}
		return id;
	}

	/**
	 * The agent a body names, `{ agent, model, effort }`, off the roster the page's
	 * conversations start from; null for `{ agent: null }`, for none.
	 */
	private async assigneeIn(request: Request): Promise<AgentPick | null> {
		const { agent, model, effort } = await body(request);
		if (agent === null || agent === undefined || agent === "") {
			return null;
		}
		const held = this.#conversations.held();
		const picked = pickAgent(
			held.agents.map((each) => ({ ...each, models: modelsOf(each) })),
			String(agent),
			model === null || model === undefined || model === ""
				? undefined
				: String(model),
		);
		return effort === null || effort === undefined || effort === ""
			? picked
			: {
					...picked,
					effort: pickEffort(
						(await held.settings())[picked.agent],
						picked.agent,
						String(effort),
					),
				};
	}
}

/** Where a task write asks to put it; absent leaves it to the write. */
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
	if (raw === "" || !Number.isInteger(id) || id < 0) {
		fail("usage", `'${raw}' is not a lane`, { lane: raw });
	}
	return id;
}

/** The slug the form names, or none when it leaves the field out or blank. */
function slugIn(form: FormData): string | undefined {
	const slug = String(form.get("slug") ?? "").trim();
	return slug === "" ? undefined : slug;
}
