import { NodeFs } from "webappwiz/system";
import {
	addVersion,
	artifactResponse,
	deleteVersion,
	removeNamed,
} from "../artifacts";
import { fail } from "../exit";
import { Everywhere } from "../projects";
import type { Project } from "../server/shared";
import {
	body,
	fileResponse,
	MEDIA_TYPES,
	refuse,
	uploads,
} from "../server/shared";
import { SuiteGrants } from "../server/suite-grant";
import type { Conversations } from "./conversations";
import { listing } from "./listing";
import { type Answer, DEVICES, FROM_HEADER, type Upload } from "./state";
import { ConversationStream, type ConversationsHeard } from "./stream";
import { type Tree, treeOf } from "./tree";

/** What the agent is told once the person approves its whole-suite run. */
export const SUITE_APPROVED =
	"Approved: run the whole test suite once, with `splates dev test` (or `splates dev premerge`). The approval is used up by that run; ask again with a new card for another.";

/**
 * How a project's page talks to agents: starting, prompting and steering its
 * conversations, and hearing each change to them as it streams. Each handler
 * is a property, so `serveProject` spreads them into the project's routes;
 * what they work on stays private, out of the spread.
 */
export class ConversationRoutes {
	readonly #project: Project;
	readonly #conversations: Conversations | null;
	/** Every project's conversations, where a caller of one here may be. */
	readonly #everywhere: Everywhere | null;
	/** Each change to them, to pages and other listeners; null while they are off. */
	readonly #stream: ConversationStream | null;

	constructor(
		project: Project,
		conversations: Conversations | null,
		everywhere: Everywhere | null = null,
	) {
		this.#project = project;
		this.#conversations = conversations;
		this.#everywhere =
			everywhere ??
			(conversations === null
				? null
				: Everywhere.onlyHere(project.service.git.root, conversations));
		this.#stream =
			conversations === null ? null : new ConversationStream(conversations);
	}

	/**
	 * Tells `heard` of each change a page's stream hears, at the same beat,
	 * until the returned function is called.
	 */
	listen(heard: ConversationsHeard): () => void {
		return this.#stream?.listen(heard) ?? (() => {});
	}

	/** The conversations a page may hold, or a refusal when they are off. */
	/** Every project's conversations, refusing as `held` does while they are off. */
	#anywhere(): Everywhere {
		if (this.#everywhere === null) {
			fail("not_found", "conversations are off", {});
		}
		return this.#everywhere;
	}

	held(): Conversations {
		if (this.#conversations === null) {
			fail("not_found", "conversations are off", {});
		}
		return this.#conversations;
	}

	/**
	 * Asks every conversation at work for a checkpoint, or only those `only`
	 * names by id, without waiting on the agents, passing over the idle ones,
	 * whose turn has ended already: one whose task is merging
	 * gets to finish the merge first. While one is still asked, the
	 * checkpoint under way stands, and nothing is asked again. Answers with
	 * what settles as each asked answers. With `budget`, a worker budget
	 * hard stop's reason, it asks those `only` names for the budget, beside
	 * any checkpoint under way.
	 */
	readonly checkpoint = async (
		only?: string[],
		budget: string | null = null,
	): Promise<Promise<void>[]> => {
		// A pause is the person's, and a budget stop the budget's: each goes
		// on beside a restart's, and neither is the other's to dismiss.
		const all = ((await this.#conversations?.list()) ?? []).filter(
			(each) =>
				!each.state.pausing &&
				(budget === null ? each.state.budgetStop === null : true),
		);
		if (
			budget === null &&
			all.some((each) => each.state.checkpoint === "asked")
		) {
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
			if (status !== "running" && status !== "starting") {
				continue;
			}
			const worktree =
				task === null ? null : await this.#project.service.find(task);
			asked.push(
				conversation
					.checkpoint(worktree?.status === "merging", budget)
					.catch(() => {})
					.then(() => conversation.answered()),
			);
		}
		return asked;
	};

	/** Asks the agents that do not send their limits for them, now and then. */
	readonly refreshLimits = async (): Promise<Response> => {
		await this.held().refreshLimits();
		return Response.json({});
	};

	/** Saves a setting a new conversation's agent starts with, before one starts. */
	readonly chooseDefault = async (request: Request): Promise<Response> => {
		const { agent, id, value } = await body(request);
		await this.held().chooseDefault(
			String(agent ?? ""),
			String(id ?? ""),
			String(value ?? ""),
		);
		return Response.json({});
	};

	readonly listConversations = async (): Promise<Response> => {
		return Response.json(await listing(this.held()));
	};

	/** One conversation whole, as a listing sends only summaries. */
	readonly showConversation = async (request: Request): Promise<Response> => {
		return Response.json((await this.conversationAt(request)).state);
	};

	/** The tree a terminal opens in: `?task=`'s worktree, or the main tree. */
	readonly terminalTree = async (request: Request): Promise<string> => {
		const [, cwd] = await this.treeFor(
			new URL(request.url).searchParams.get("task"),
		);
		return cwd;
	};

	readonly startConversation = async (request: Request): Promise<Response> => {
		const { id, agent, task, settings, model, assigned, autoPick } =
			await body(request);
		const [named, cwd, base, caller] = await this.treeFor(task);
		const conversation = await this.held().start(String(agent ?? ""), {
			id: typeof id === "string" ? id : undefined,
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
		// Auto pick's model and effort for the agent the person picked: the
		// first message decides them, before the agent reads it.
		if (autoPick === true) {
			conversation.switchAutoPick(true);
		}
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

	// The agent's own `splates` sends this as it takes or lands a task. `from`
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
	// `FROM_HEADER` names the layout they were said on.
	readonly promptConversation = async (request: Request): Promise<Response> => {
		const conversation = await this.conversationAt(request);
		const form = await request.formData();
		const files: Upload[] = (await uploads(form)).map(
			({ name, mimeType, bytes }) => ({ title: name, mimeType, bytes }),
		);
		const from = DEVICES.find(
			(each) => each === request.headers.get(FROM_HEADER),
		);
		const text = String(form.get("text") ?? "");
		await conversation.prompt(text, files, from, {
			dictated: form.get("dictated") === "true",
			id: form.get("id")?.toString() || undefined,
		});
		return Response.json(conversation.state);
	};

	/**
	 * The person approves the agent's ask to run the whole test suite: one
	 * run of it, outside a merge's gate, which the agent is then told to start.
	 */
	readonly approveSuite = async (request: Request): Promise<Response> => {
		const conversation = await this.conversationAt(request);
		const { ps } = this.#project.service;
		await new SuiteGrants({ fs: new NodeFs(), ps }).grant(conversation.id);
		await conversation.prompt(SUITE_APPROVED);
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

	// One version of an artifact an agent kept: 404 `not_found` for a name or
	// version the record lacks, 404 `gone` for one whose bytes were deleted, so
	// the page shows a placeholder for it.
	readonly conversationArtifact = async (
		request: Request,
	): Promise<Response> => {
		const conversation = await this.conversationAt(request);
		return artifactResponse(request, conversation);
	};

	readonly answerConversation = async (request: Request): Promise<Response> => {
		const conversation = await this.conversationAt(request);
		const { ask, answer } = await body(request);
		conversation.answer(String(ask ?? ""), answer as Answer);
		return Response.json(conversation.state);
	};

	readonly cancelConversation = async (request: Request): Promise<Response> => {
		const conversation = await this.conversationAt(request);
		await conversation.cancel();
		return Response.json(conversation.state);
	};

	/**
	 * Checkpoints a running agent for the person and leaves it stopped,
	 * answering without waiting on the agent; one whose task is merging gets
	 * to finish the merge first.
	 */
	readonly pauseConversation = async (request: Request): Promise<Response> => {
		const conversation = await this.conversationAt(request);
		const { task, status } = conversation.state;
		if (status !== "running" && status !== "starting") {
			fail(
				"usage",
				`conversation ${conversation.id} is ${status}: only a running agent pauses`,
				{ conversation: conversation.id },
			);
		}
		const worktree =
			task === null ? null : await this.#project.service.find(task);
		void conversation.pause(worktree?.status === "merging").catch(() => {});
		return Response.json(conversation.state);
	};

	/**
	 * Starts a conversation's agent again in a new session on its task,
	 * answering once it is told to claim the task.
	 */
	readonly restartConversation = async (
		request: Request,
	): Promise<Response> => {
		const conversation = await this.conversationAt(request);
		await conversation.restart();
		return Response.json(conversation.state);
	};

	/**
	 * Takes a conversation off its task, its agent stopped, for another to
	 * take on, answering with the prompt that has the next one claim it.
	 */
	readonly handOffConversation = async (
		request: Request,
	): Promise<Response> => {
		const conversation = await this.conversationAt(request);
		const prompt = await conversation.handOff();
		return Response.json({ state: conversation.state, prompt });
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
		const { background } = await body(request);
		await conversation.stopBackground(String(background ?? ""));
		return Response.json(conversation.state);
	};

	readonly unqueueConversation = async (
		request: Request,
	): Promise<Response> => {
		const conversation = await this.conversationAt(request);
		const { index } = await body(request);
		return Response.json(conversation.unqueue(Number(index ?? -1)));
	};

	readonly sendQueuedNow = async (request: Request): Promise<Response> => {
		const conversation = await this.conversationAt(request);
		await conversation.sendNow();
		return Response.json(conversation.state);
	};

	readonly chooseSetting = async (request: Request): Promise<Response> => {
		const conversation = await this.conversationAt(request);
		const { id, value } = await body(request);
		await conversation.choose(String(id ?? ""), String(value ?? ""));
		return Response.json(conversation.state);
	};

	readonly switchAutoPick = async (request: Request): Promise<Response> => {
		const conversation = await this.conversationAt(request);
		const { on } = await body(request);
		conversation.switchAutoPick(on === true);
		return Response.json(conversation.state);
	};

	readonly renameConversation = async (request: Request): Promise<Response> => {
		const conversation = await this.conversationAt(request);
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

	readonly markRead = async (request: Request): Promise<Response> => {
		const conversation = await this.conversationAt(request);
		const { read } = await body(request);
		await conversation.markRead(Number(read));
		return Response.json(conversation.state);
	};

	readonly pinConversation = async (request: Request): Promise<Response> => {
		const conversation = await this.conversationAt(request);
		const { pinned } = await body(request);
		await conversation.pin(pinned === true);
		return Response.json(conversation.state);
	};

	readonly reparentConversation = async (
		request: Request,
	): Promise<Response> => {
		const conversation = await this.conversationAt(request);
		// A subagent stays under the one it answers to.
		const { parent } = await body(request);
		if (parent !== null && typeof parent !== "string") {
			fail("usage", "parent is a conversation's id, or null for the top", {
				conversation: conversation.id,
			});
		}
		if (parent === conversation.id) {
			fail(
				"usage",
				`conversation ${conversation.id} cannot nest under itself`,
				{ conversation: conversation.id },
			);
		}
		await conversation.reparent(parent);
		return Response.json(conversation.state);
	};

	readonly archiveConversation = async (
		request: Request,
	): Promise<Response> => {
		const conversation = await this.conversationAt(request);
		const { archived } = await body(request);
		// The agents it handed tasks to or started may be in other projects.
		const all = (await this.#anywhere().list()).map(
			(each) => each.conversation,
		);
		if (archived === false) {
			await conversation.unarchive();
			// Those its archiving took with it come back with it.
			await Promise.all(
				all
					.filter((each) => each.state.archivedWith === conversation.id)
					.map((each) => each.unarchive()),
			);
		} else {
			if (conversation.state.persistent !== undefined) {
				fail(
					"usage",
					`conversation ${conversation.id} is the project's ${conversation.state.persistent}, kept while it is on: turn it off from the Automations page to retire it`,
					{ conversation: conversation.id },
				);
			}
			// The agents a lane's orchestrator started work its lanes: they go
			// with it, stopped mid-work if they were at it, as the page confirmed.
			await Promise.all(
				all
					.filter(
						(each) =>
							each.state.startedBy === conversation.id && !each.state.archived,
					)
					.map((each) => each.archive(conversation.id)),
			);
			await conversation.archive();
		}
		return Response.json(conversation.state);
	};

	// The agent's own `splates artifact add` and `remove`, and the person's delete
	// of one version's bytes, which `remove` leaves kept.
	readonly addArtifact = async (request: Request): Promise<Response> =>
		addVersion(request, await this.conversationAt(request));

	readonly removeArtifact = async (request: Request): Promise<Response> =>
		removeNamed(request, await this.conversationAt(request));

	readonly deleteArtifactVersion = async (
		request: Request,
	): Promise<Response> =>
		deleteVersion(request, await this.conversationAt(request));

	readonly conversationEvents = async (): Promise<Response> => {
		this.held();
		return (this.#stream as ConversationStream).events();
	};

	async disposeAsync(): Promise<void> {
		this.#stream?.dispose();
		await this.#conversations?.disposeAsync();
	}

	/** Where a conversation for `task` runs, as `treeOf` says. */
	private treeFor(task: unknown): Promise<Tree> {
		return treeOf(this.#project.service, task);
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
}
