import type { Resource } from "webappwiz/disposable";
import { ConversationRoutes, type Conversations } from "../conversations";
import { fail } from "../exit";
import { continuedReference, needs } from "../plans";
import { Everywhere, GENERAL, GENERAL_NAME } from "../projects";
import type { Snapshot } from "../tasks";
import { type EventSink, eventStream } from "./http";
import type { Handler, ProjectHeard, Served } from "./project";
import type { Behind, Release } from "./release";
import { body } from "./shared";

/** What the server needs to construct General before its release feed exists. */
export interface GeneralOptions {
	conversations: Conversations;
	root: string;
	scratchRoot: string;
}

/** The release and slot metadata General's static snapshot shares with projects. */
interface GeneralSettings {
	release: () => Release | null;
	behind: () => Behind | null;
	unbuilt: boolean;
	slot: Snapshot["slot"];
	/** The registered project `slug` names, served, as a request's `?project=` reaches it. */
	projectNamed: (slug: string) => Promise<Served>;
}

/** The shared conversation handlers exposed on a General, assigned from `talks`. */
export interface General
	extends Omit<Pick<ConversationRoutes, keyof ConversationRoutes>, "listen"> {}

/** The machine's projectless conversations, shown as one global destination. */
export class General {
	readonly talks: ConversationRoutes;
	readonly startAutoPick: Handler;
	readonly snapshot: Handler;
	readonly events: Handler;
	readonly continueConversation: Handler;
	private readonly listeners = new Set<EventSink>();

	constructor(
		readonly conversations: Conversations,
		readonly root: string,
		readonly scratchRoot: string,
		private readonly opts: GeneralSettings,
	) {
		this.talks = new ConversationRoutes(
			null,
			conversations,
			Everywhere.onlyHere(this.root, conversations),
			scratchRoot,
		);
		Object.assign(this, this.talks);
		this.startAutoPick = this.talks.startConversation;
		this.snapshot = async () => Response.json(await this.current());
		this.events = async () => eventStream(this.listeners);
		this.continueConversation = (request) => this.continueIn(request);
	}

	/**
	 * Carries the General conversation the path names on in the project the
	 * body names, for work that changes its repository: a new conversation in
	 * that project's main tree, on the same agent and settings, told to read
	 * what was said here. The General one stays as it is.
	 */
	private async continueIn(request: Request): Promise<Response> {
		const id = new URL(request.url).pathname.split("/")[3] ?? "";
		const from = await this.conversations.find(id);
		const { project: slug } = await body(request);
		if (typeof slug !== "string" || slug === "" || slug === GENERAL) {
			fail("usage", "name the project to continue in", { project: slug });
		}
		const project = await this.opts.projectNamed(slug);
		if (project.conversations === null) {
			fail("not_found", `conversations are off in '${slug}'`, {
				project: slug,
			});
		}
		const transcript = await from.keepTranscript();
		const { agent, settings } = from.state;
		const offered = new Set(
			((await project.conversations.settings())[agent] ?? []).map(
				({ id }) => id,
			),
		);
		const started = await project.conversations.start(agent, {
			task: null,
			cwd: project.root,
			settings: Object.fromEntries(
				settings
					.filter((each) => offered.has(each.id))
					.map((each) => [each.id, each.current]),
			),
			assigned: true,
		});
		void started.prompt(continuedReference(transcript)).catch(() => {});
		return Response.json({ project: slug, id: started.id });
	}

	current(): Promise<Snapshot> {
		return Promise.resolve({
			project: GENERAL,
			repo: GENERAL_NAME,
			path: this.root,
			root: this.root,
			worktreeRoot: this.scratchRoot,
			taskStalenessMs: 0,
			todos: [],
			lanes: [],
			laneNames: [],
			tasks: [],
			creds: [],
			trunk: "scratch",
			release: this.opts.release(),
			behind: this.opts.behind(),
			unbuilt: this.opts.unbuilt,
			slot: this.opts.slot,
		});
	}

	async waiting(): Promise<number> {
		return (await this.needing()).rows.filter(
			({ need }) => need.kind === "waiting",
		).length;
	}

	async needing() {
		return {
			rows: needs({
				tasks: [],
				conversations: (await this.conversations.list()).map(
					({ state }) => state,
				),
			}),
			lanes: [],
		};
	}

	listen(heard: ProjectHeard): Resource {
		return { dispose: this.talks.listen(heard) };
	}

	disposeAsync(): Promise<void> {
		return this.talks.disposeAsync();
	}
}
