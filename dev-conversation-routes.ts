import { Duration, SystemTimer, Throttler } from "webappwiz/time";
import type { Conversation } from "./conversation";
import type { Answer, Conversations, Upload } from "./conversations";
import {
	body,
	type EventSink,
	eventStream,
	fileResponse,
	MEDIA_TYPES,
	refuse,
} from "./dev-http";
import type { DevContext, Project } from "./dev-project";
import { fail } from "./exit";
import { stoppedReference } from "./prompts";
import { modelsOf } from "./roster";

/**
 * How a project's page talks to agents: starting, prompting and steering its
 * conversations, and hearing each change to them as it streams. Each handler
 * is a property, so `serveProject` spreads them into the project's routes;
 * what they work on stays private, out of the spread.
 */
export class ConversationRoutes {
	readonly #project: Project;
	readonly #conversations: Conversations | null;
	readonly #context: DevContext;
	// Each change carries the whole conversation, since an agent streams in
	// small pieces and a page refetching after each would fall behind. At most
	// one per conversation per beat, the latest, which holds everything before.
	readonly #listeners = new Set<EventSink>();
	readonly #beats = new Map<string, Throttler>();
	readonly #unlisten: (() => void) | undefined;
	readonly #unlistenRemoved: (() => void) | undefined;

	constructor(
		project: Project,
		conversations: Conversations | null,
		context: DevContext,
	) {
		this.#project = project;
		this.#conversations = conversations;
		this.#context = context;
		const timer = new SystemTimer();
		this.#unlisten = conversations?.events.on("changed", (id) => {
			const beat = this.#beats.get(id) ?? new Throttler(timer, BEAT);
			this.#beats.set(id, beat);
			beat.call(async () => {
				// Gone meanwhile, deleted as an older archived one: `removed` says so.
				const state = (await conversations.list()).find(
					(each) => each.id === id,
				)?.state;
				if (state !== undefined) {
					this.#send(encoder.encode(`data: ${JSON.stringify(state)}\n\n`));
				}
			});
		});
		// An older archived conversation, deleted: the page drops it.
		this.#unlistenRemoved = conversations?.events.on("removed", (id) => {
			this.#beats.get(id)?.dispose();
			this.#beats.delete(id);
			this.#send(encoder.encode(`event: removed\ndata: ${id}\n\n`));
		});
	}

	/** The conversations a page may hold, or a refusal when they are off. */
	held(): Conversations {
		if (this.#conversations === null) {
			fail("not_found", "conversations are off", {});
		}
		return this.#conversations;
	}

	/**
	 * Asks every live conversation for a checkpoint, or only those `only`
	 * names by id, without waiting on the agents: one whose task is merging
	 * gets to finish the merge first. While one is still asked, the
	 * checkpoint under way stands, and nothing is asked again. Answers with
	 * what settles as each asked answers.
	 */
	readonly checkpoint = async (only?: string[]): Promise<Promise<void>[]> => {
		const all = (await this.#conversations?.list()) ?? [];
		if (all.some((each) => each.state.checkpoint === "asked")) {
			return [];
		}
		const asked: Promise<void>[] = [];
		for (const conversation of all) {
			if (only !== undefined && !only.includes(conversation.id)) {
				continue;
			}
			// What the last one said goes, so this one lists only its own.
			conversation.dismissCheckpoint();
			const { task, status } = conversation.state;
			if (status === "stopped" || status === "failed") {
				continue;
			}
			const worktree =
				task === null ? null : await this.#project.service.find(task);
			asked.push(
				conversation
					.checkpoint(worktree?.status === "merging")
					.catch(() => {})
					.then(() => conversation.answered()),
			);
		}
		return asked;
	};

	readonly listConversations = async (): Promise<Response> => {
		const all = this.held();
		const offered = await all.settings();
		const limits = await all.limits();
		return Response.json({
			agents: all.agents.map((each) => ({
				id: each.id,
				name: each.name,
				models: modelsOf(each).map(({ id, name }) => ({ id, name })),
				settings: offered[each.id] ?? [],
				limits: limits[each.id] ?? [],
			})),
			conversations: (await all.list()).map((each) => each.state),
		});
	};

	/** The tree a terminal opens in: `?task=`'s worktree, or the main tree. */
	readonly terminalTree = async (request: Request): Promise<string> => {
		const [, cwd] = await this.treeFor(
			new URL(request.url).searchParams.get("task"),
		);
		return cwd;
	};

	readonly startConversation = async (request: Request): Promise<Response> => {
		const { agent, task, settings, model, assigned } = await body(request);
		const [named, cwd, base, caller] = await this.treeFor(task);
		const conversation = await this.held().start(String(agent ?? ""), {
			task: named,
			base,
			caller,
			cwd,
			model: typeof model === "string" && model !== "" ? model : undefined,
			assigned: assigned === true,
			settings: Object.fromEntries(
				Object.entries(
					typeof settings === "object" && settings !== null ? settings : {},
				).map(([id, value]) => [id, String(value)]),
			),
		});
		return Response.json(conversation.state);
	};

	/**
	 * The sessions the agents hold in `?task=`'s tree that no conversation
	 * does, such as ones started in their CLI, to bring in.
	 */
	readonly listSessions = async (request: Request): Promise<Response> => {
		const [, cwd] = await this.treeFor(
			new URL(request.url).searchParams.get("task"),
		);
		return Response.json(await this.held().sessions(cwd));
	};

	/** Brings in a session an agent holds, as a conversation in `task`'s tree. */
	readonly bringSession = async (request: Request): Promise<Response> => {
		const { agent, session, task, title } = await body(request);
		const [named, cwd, base, caller] = await this.treeFor(task);
		const conversation = await this.held().bring(
			String(agent ?? ""),
			String(session ?? ""),
			{
				task: named,
				base,
				caller,
				cwd,
				title: typeof title === "string" && title !== "" ? title : null,
			},
		);
		return Response.json(conversation.state);
	};

	// The agent's own `arbor` sends this as it takes or lands a task. `from`
	// names the task it is leaving, so removing some other task moves nothing.
	// A subagent runs with its caller's env, so its claim of a part of the
	// conversation's task arrives here too, and leaves the conversation be.
	// `add` sends `base` itself, since it tells this before the record that
	// names the base is written, and handing out a part leaves it be as well.
	readonly moveConversation = async (request: Request): Promise<Response> => {
		const conversation = await this.conversationAt(request);
		const { task, from, base: sent } = await body(request);
		const [named, cwd, recorded, caller] = await this.treeFor(task);
		const base = typeof sent === "string" ? sent : recorded;
		const leaving = from === undefined || from === conversation.state.task;
		if (leaving && !(await this.isPartOf(base, conversation.state.task))) {
			conversation.move(named, cwd, base, caller);
		}
		return Response.json(conversation.state);
	};

	// A form: the words as `text`, and each file sent with them as `file`.
	readonly promptConversation = async (request: Request): Promise<Response> => {
		const conversation = await this.conversationAt(request);
		await this.#refuseHandedOut(conversation);
		const form = await request.formData();
		const files: Upload[] = [];
		for (const file of form.getAll("file")) {
			if (file instanceof File) {
				files.push({
					title: file.name || "pasted",
					mimeType: file.type,
					bytes: new Uint8Array(await file.arrayBuffer()),
				});
			}
		}
		await conversation.prompt(String(form.get("text") ?? ""), files);
		return Response.json(conversation.state);
	};

	// Only a file the person sent in it, by the name its message gives.
	readonly conversationAttachment = async (
		request: Request,
	): Promise<Response> => {
		const conversation = await this.conversationAt(request);
		const name = new URL(request.url).pathname.split("/")[5] ?? "";
		const attachment = await conversation.attachment(decodeURIComponent(name));
		if (attachment === null) {
			return refuse(
				404,
				"not_found",
				`conversation ${conversation.id} sent no file ${name}`,
			);
		}
		const type = MEDIA_TYPES[name.split(".").at(-1)?.toLowerCase() ?? ""];
		return fileResponse(request, attachment.bytes, type, {
			// Named for what is in it, so it never changes.
			"cache-control": "private, max-age=31536000, immutable",
		});
	};

	readonly answerConversation = async (request: Request): Promise<Response> => {
		const conversation = await this.conversationAt(request);
		const { ask, answer } = await body(request);
		conversation.answer(String(ask ?? ""), answer as Answer);
		return Response.json(conversation.state);
	};

	readonly cancelConversation = async (request: Request): Promise<Response> => {
		const conversation = await this.conversationAt(request);
		await this.#refuseHandedOut(conversation);
		await conversation.cancel();
		return Response.json(conversation.state);
	};

	/** What a background command prints, as it prints it, until it ends. */
	readonly backgroundOutput = async (request: Request): Promise<Response> => {
		const conversation = await this.conversationAt(request);
		const background = new URL(request.url).pathname.split("/")[5] ?? "";
		return new Response(
			conversation.backgroundOutput(decodeURIComponent(background)),
			{
				headers: {
					"content-type": "text/plain; charset=utf-8",
					"cache-control": "no-cache",
					"x-content-type-options": "nosniff",
				},
			},
		);
	};

	readonly stopBackground = async (request: Request): Promise<Response> => {
		const conversation = await this.conversationAt(request);
		await this.#refuseHandedOut(conversation);
		const { background } = await body(request);
		await conversation.stopBackground(String(background ?? ""));
		return Response.json(conversation.state);
	};

	/** Forgets the checkpoint here, so the next click starts a new one. */
	readonly dismissCheckpoint = async (): Promise<Response> => {
		this.#context.dismiss();
		for (const conversation of await this.held().list()) {
			conversation.dismissCheckpoint();
		}
		return Response.json({});
	};

	readonly unqueueConversation = async (
		request: Request,
	): Promise<Response> => {
		const conversation = await this.conversationAt(request);
		await this.#refuseHandedOut(conversation);
		const { index } = await body(request);
		return Response.json(conversation.unqueue(Number(index ?? -1)));
	};

	readonly sendQueuedNow = async (request: Request): Promise<Response> => {
		const conversation = await this.conversationAt(request);
		await this.#refuseHandedOut(conversation);
		await conversation.sendNow();
		return Response.json(conversation.state);
	};

	readonly chooseSetting = async (request: Request): Promise<Response> => {
		const conversation = await this.conversationAt(request);
		await this.#refuseHandedOut(conversation);
		const { id, value } = await body(request);
		await conversation.choose(String(id ?? ""), String(value ?? ""));
		return Response.json(conversation.state);
	};

	readonly renameConversation = async (request: Request): Promise<Response> => {
		const conversation = await this.conversationAt(request);
		await this.#refuseHandedOut(conversation);
		const { name } = await body(request);
		await conversation.rename(String(name ?? ""));
		return Response.json(conversation.state);
	};

	readonly markUnread = async (request: Request): Promise<Response> => {
		const conversation = await this.conversationAt(request);
		const { unread } = await body(request);
		await conversation.markUnread(unread === true);
		return Response.json(conversation.state);
	};

	readonly archiveConversation = async (
		request: Request,
	): Promise<Response> => {
		const conversation = await this.conversationAt(request);
		await this.#refuseHandedOut(conversation);
		const { archived } = await body(request);
		const all = await this.held().list();
		if (archived === false) {
			await conversation.unarchive();
			// Those its archiving took with it come back with it.
			await Promise.all(
				all
					.filter((each) => each.state.archivedWith === conversation.id)
					.map((each) => each.unarchive()),
			);
		} else {
			// The agents it handed tasks to answer to it alone: they go with it,
			// stopped mid-work if they were at it, as the page confirmed.
			await Promise.all(
				all
					.filter(
						(each) =>
							each.state.handedBy === conversation.id && !each.state.archived,
					)
					.map((each) => each.archive(conversation.id)),
			);
			await conversation.archive();
		}
		return Response.json(conversation.state);
	};

	/**
	 * Says `text` in a conversation as the person would, for the conversation
	 * that handed it its task, as `arbor tell` does: the one way in to it.
	 */
	readonly tellConversation = async (request: Request): Promise<Response> => {
		const conversation = await this.conversationAt(request);
		const { from, text } = await body(request);
		if (
			conversation.state.handedBy === null ||
			conversation.state.handedBy !== from
		) {
			fail(
				"usage",
				`conversation ${conversation.id} answers only to the one that handed it its task`,
				{ conversation: conversation.id },
			);
		}
		await conversation.prompt(String(text ?? ""));
		return Response.json(conversation.state);
	};

	/**
	 * The person's way out of a handed-out agent: stops its turn and its
	 * process, and tells the conversation that handed it out, which decides
	 * what becomes of the task. Its next word from that one resumes it.
	 */
	readonly terminateConversation = async (
		request: Request,
	): Promise<Response> => {
		const conversation = await this.conversationAt(request);
		const { handedBy, task, lastTask } = conversation.state;
		if (handedBy === null) {
			fail(
				"usage",
				`conversation ${conversation.id} was handed nothing: stop its turn instead`,
				{ conversation: conversation.id },
			);
		}
		if (conversation.state.status === "running") {
			await conversation.cancel();
		}
		await conversation.stop();
		const caller = (await this.held().list()).find(
			(each) => each.id === handedBy,
		);
		// An archived one took this one with it, and is told nothing.
		if (caller !== undefined && !caller.state.archived) {
			await caller.prompt(
				stoppedReference(task ?? lastTask ?? conversation.id),
			);
		}
		return Response.json(conversation.state);
	};

	/**
	 * Refuses the page a write to a conversation another handed its task to,
	 * while that one is there to answer to: the person talks to that one.
	 */
	async #refuseHandedOut(conversation: Conversation): Promise<void> {
		const { handedBy } = conversation.state;
		if (handedBy === null) {
			return;
		}
		const caller = (await this.held().list()).find(
			(each) => each.id === handedBy,
		);
		if (caller !== undefined) {
			fail(
				"blocked",
				`conversation ${conversation.id} answers to conversation ${handedBy}: talk to it there`,
				{ conversation: conversation.id, handedBy },
			);
		}
	}

	readonly conversationEvents = async (): Promise<Response> => {
		this.held();
		return eventStream(this.#listeners);
	};

	async disposeAsync(): Promise<void> {
		this.#unlisten?.();
		this.#unlistenRemoved?.();
		for (const beat of this.#beats.values()) {
			beat.dispose();
		}
		await this.#conversations?.disposeAsync();
	}

	/** Where a conversation for `task` runs: its worktree, or the main tree. */
	/**
	 * `task`'s name, worktree, the branch it was cut from, and the
	 * conversation whose agent added it.
	 */
	private async treeFor(
		task: unknown,
	): Promise<[string | null, string, string | null, string | null]> {
		const { service } = this.#project;
		const named = typeof task === "string" && task !== "" ? task : null;
		const worktree = named === null ? null : await service.find(named);
		if (worktree !== null && !worktree.exists) {
			fail("not_found", `no worktree for '${named}'`, { task: named });
		}
		return [
			named,
			worktree?.path ?? service.git.root,
			worktree?.base ?? null,
			worktree?.caller ?? null,
		];
	}

	/**
	 * Whether a task landing on `base` is a part of `task`, or a part of one
	 * of its parts, following each base back while it is a task's branch.
	 */
	private async isPartOf(
		base: string | null,
		task: string | null,
	): Promise<boolean> {
		const { service } = this.#project;
		const seen = new Set<string>();
		for (
			let parent = service.taskFor(base);
			parent !== null && !seen.has(parent);
			parent = service.taskFor((await service.find(parent)).base)
		) {
			if (parent === task) {
				return true;
			}
			seen.add(parent);
		}
		return false;
	}

	/** The conversation a `/api/conversations/<id>` path names. */
	private conversationAt(request: Request) {
		return this.held().find(new URL(request.url).pathname.split("/")[3] ?? "");
	}

	#send(chunk: Uint8Array): void {
		for (const stream of this.#listeners) {
			stream.enqueue(chunk);
		}
	}
}

/** How often an open page hears about one conversation while its agent streams. */
const BEAT = Duration.ms(50);

const encoder = new TextEncoder();
