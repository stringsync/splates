import type { Resource } from "webappwiz/disposable";
import { Duration } from "webappwiz/time";
import type { AgentConnection } from "./agent-connection";
import type { ConversationFiles } from "./conversation-files";
import type { ConversationDeps, ConversationHost } from "./conversation-host";
import {
	delivered,
	messageOf,
	said,
	shown,
	takeBack,
	textOf,
} from "./conversation-messages";
import type {
	Attached,
	Checkpoint,
	Device,
	Message,
	Sent,
	Status,
	Upload,
} from "./conversation-state";
import { fail } from "./exit";
import { agentTurn, tally } from "./fold";
import { CHECKPOINT } from "./prompts";

/** How long an agent has to answer a checkpoint before it is unanswered. */
const CHECKPOINT_WAIT = Duration.mins(2);

/** What else a prompt says about who said it. */
export interface PromptOptions {
	/** The conversation that said it with `arbor tell`, when the person did not. */
	told?: string;
	/** Whether the person said it into the mic rather than typed it. */
	dictated?: boolean;
	/**
	 * Whether it stops the running turn and follows it, rather than joining
	 * it, for a change of plans.
	 */
	stop?: boolean;
}

/** What a message's options mark it with, in the log and the thread alike. */
type Marks = Pick<Message, "told" | "dictated">;

/**
 * The turns of a conversation: what the person says goes to the agent as a
 * prompt, steered into the turn it is running or queued for when that ends,
 * and a checkpoint asks it to stop where it is.
 */
export class ConversationTurns {
	/** Whether the person cancelled the last turn, which holds the queue. */
	private held = false;
	/** Gives up on an asked checkpoint once `CHECKPOINT_WAIT` is out. */
	private waiting: Resource | null = null;
	/** Whether a checkpoint is cancelling the turn, whose end is not its own. */
	private interrupting = false;

	constructor(
		private readonly host: ConversationHost,
		private readonly deps: ConversationDeps,
		private readonly connection: AgentConnection,
		private readonly files: ConversationFiles,
	) {}

	/**
	 * Says `text` to the agent, with `files`, once it has started, resuming
	 * the session first when it stopped and unarchiving it when archived.
	 * While the agent works, it joins the
	 * running turn when the agent can take it there, and otherwise waits for
	 * the turn to end.
	 */
	async prompt(
		text: string,
		files: Upload[] = [],
		from?: Device,
		{ told, dictated = false, stop = false }: PromptOptions = {},
	): Promise<void> {
		const { host, connection } = this;
		const { state } = host;
		const words = text.trim();
		if (words === "" && files.length === 0) {
			fail("usage", "say something to the agent", { conversation: state.id });
		}
		// Said to an archived one, it goes back on the list to carry on.
		await host.unarchive();
		if (state.status === "stopped" || state.status === "failed") {
			await host.resume();
		}
		// Held while the agent starts, it finds a turn running only because a
		// message said before it started one, which has yet to reach the agent:
		// steered in, it would join that message rather than follow it.
		const waited = host.opening !== null;
		await host.opening;
		if (
			(state.status !== "idle" && state.status !== "running") ||
			!connection.connected
		) {
			fail(
				"usage",
				`conversation ${state.id} is ${state.status}: wait for the agent, or cancel its turn`,
				{ conversation: state.id },
			);
		}
		// Said after a checkpoint ended, the work goes on past it; one that
		// failed to come back keeps it, for the next resume to try again.
		if (
			words !== CHECKPOINT &&
			state.checkpoint !== null &&
			state.checkpoint !== "asked"
		) {
			this.mark(null);
		}
		const kept = await this.files.keep(files, connection.sees);
		const marks: Marks = {
			...(told === undefined ? {} : { told }),
			...(dictated ? { dictated: true } : {}),
		};
		if (state.status === "running") {
			if (stop) {
				this.queue(words, kept, from, marks);
				await this.halt();
				// After `halt`, which holds the queue for a stop.
				this.held = false;
				return;
			}
			if (!connection.canSteer || waited) {
				this.queue(words, kept, from, marks);
				return;
			}
			// Said into the turn first, so only what it took shows as steered.
			// One it failed to take waits for the turn's end, as for an agent
			// that cannot steer, rather than being refused: that end's prompt
			// says what is wrong with it, if anything is.
			const outcome = await connection
				.steer(await this.content([{ ...said(words, null, kept), ...marks }]))
				.catch(() => undefined);
			if (outcome === "injected" || outcome === "startedNewTurn") {
				const at = host.now();
				// A new turn it started is a turn like any other.
				const steered =
					outcome === "injected" ? { steered: true as const } : {};
				host.log.write({
					kind: "prompt",
					text: words,
					at,
					...steered,
					...(from === undefined ? {} : { from }),
					...marks,
					...shown(kept),
				});
				state.messages.push({
					...said(words, at, kept),
					...steered,
					...marks,
				});
				host.changed();
				return;
			}
			// Not taken, or the turn ended on the way: a turn of its own, then,
			// or after the next one if that has started.
			// Read again: the turn may have ended while the agent answered.
			if ((state.status as Status) !== "idle") {
				this.queue(words, kept, from, marks);
				return;
			}
		}
		this.held = false;
		const at = host.now();
		const message = { ...said(words, at, kept), ...marks };
		host.log.write({
			kind: "prompt",
			text: words,
			at,
			...(from === undefined ? {} : { from }),
			...marks,
			...shown(kept),
		});
		state.messages.push(message);
		this.send([message]);
	}

	/**
	 * Back to idle once a turn ends, then on to what was queued meanwhile,
	 * unless the person cancelled the turn: that holds the queue until they
	 * say something.
	 */
	ended(error: string | null): void {
		const { host } = this;
		const { state } = host;
		if (state.status !== "running") {
			return;
		}
		if (error !== null) {
			this.interrupt();
		}
		host.set({ status: "idle", ...(error === null ? {} : { error }) });
		host.flag(true);
		if (!this.held && state.messages.some((each) => each.queued)) {
			this.send([]);
		}
		// Still idle: the checkpoint was in the turn that ended, not queued.
		if (
			state.checkpoint === "asked" &&
			!this.interrupting &&
			(state.status as Status) === "idle"
		) {
			this.mark(error === null ? "done" : "failed");
		}
	}

	/**
	 * Marks a running turn as cut short, as when the connection is lost or the
	 * process exits, unless the person stopped it, which says so already.
	 */
	interrupt(): void {
		const { host } = this;
		if (host.state.status !== "running") {
			return;
		}
		const at = host.now();
		const turn = agentTurn(host.state, at);
		if (turn.stopped !== undefined) {
			return;
		}
		host.log.write({ kind: "interrupted", at });
		turn.interrupted = at;
	}

	/** Whether a checkpoint has ended and nothing has been said since. */
	get stoppedByCheckpoint(): boolean {
		const { checkpoint } = this.host.state;
		return checkpoint !== null && checkpoint !== "asked";
	}

	/**
	 * Asks the agent to bring its `ARBOR.md` up to date and stop, cancelling
	 * the turn it is on first, unless that turn is `merging`, which it says
	 * the checkpoint into, or queues it after. An idle agent is not asked,
	 * having ended its turn already. What the person queued stays queued, for
	 * the next prompt to send. A `pause` is forgotten once it ends, so
	 * nothing resumes it.
	 */
	async checkpoint(merging: boolean, pause = false): Promise<void> {
		const { host } = this;
		const { state } = host;
		await host.opening;
		if (state.checkpoint === "asked" || state.status !== "running") {
			return;
		}
		host.set({ pausing: pause });
		// Asked from the start, so an agent slow to stop shows as on its way,
		// and one that never stops runs out the same wait.
		this.mark("asked");
		this.waiting?.dispose();
		this.waiting = this.deps.timer.setTimeout(() => {
			if (state.checkpoint === "asked") {
				this.mark("unanswered");
			}
		}, CHECKPOINT_WAIT);
		if (state.status === "running" && !merging) {
			this.interrupting = true;
			try {
				await this.halt();
				await this.idle();
			} finally {
				this.interrupting = false;
			}
			if (
				(state.checkpoint as Checkpoint | null) !== "asked" ||
				(state.status as Status) !== "idle"
			) {
				return;
			}
		}
		if (state.status === "running") {
			await this.prompt(CHECKPOINT);
			return;
		}
		// Held, so nothing queued follows the checkpoint on its own.
		this.held = true;
		const at = host.now();
		host.log.write({ kind: "prompt", text: CHECKPOINT, at });
		const message = said(CHECKPOINT, at);
		state.messages.push(message);
		this.send([message], { alone: true });
	}

	/**
	 * Forgets the checkpoint, done or not, so the next starts afresh; an agent
	 * still on it carries on with its turn.
	 */
	dismissCheckpoint(): void {
		if (this.host.state.checkpoint !== null) {
			this.mark(null);
		}
	}

	/**
	 * Keeps where the checkpoint stands, giving up the wait once it is past
	 * asked; a pause past asked is forgotten.
	 */
	mark(checkpoint: Checkpoint | null): void {
		const ended = checkpoint !== "asked";
		if (ended) {
			this.waiting?.dispose();
			this.waiting = null;
		}
		const kept = ended && this.host.state.pausing ? null : checkpoint;
		this.host.log.write({ kind: "checkpoint", checkpoint: kept });
		this.host.set(
			ended ? { checkpoint: kept, pausing: false } : { checkpoint },
		);
	}

	/** Settles once the checkpoint asked is no longer under way. */
	answered(): Promise<void> {
		return new Promise((resolve) => {
			const check = () => {
				if (this.host.state.checkpoint !== "asked") {
					off();
					resolve();
				}
			};
			const off = this.host.events.on("changed", check);
			check();
		});
	}

	/**
	 * Takes back the `index`th queued message before the agent hears it,
	 * answering with its words and files, for the person to edit and send
	 * again.
	 */
	unqueue(index: number): { text: string; files: Attached[] } {
		const { host } = this;
		const message = takeBack(host.state.messages, index);
		if (message === null) {
			fail(
				"not_found",
				`conversation ${host.state.id} has no queued message ${index}`,
				{
					conversation: host.state.id,
				},
			);
		}
		host.log.write({ kind: "unqueue", index });
		host.changed();
		return {
			text: textOf(message),
			files: message.parts.flatMap((part) =>
				part.type === "image" || part.type === "file"
					? [
							{
								name: part.name,
								title: part.type === "file" ? part.title : part.name,
								mimeType: part.mimeType,
							},
						]
					: [],
			),
		};
	}

	/**
	 * Sends what is queued now: stops the running turn, whose end sends it,
	 * or, with no turn running, sends it as one.
	 */
	async sendNow(): Promise<void> {
		const { host } = this;
		const { state } = host;
		if (!state.messages.some((each) => each.queued)) {
			return;
		}
		if (state.status === "running") {
			await this.halt();
			// After `halt`, which holds the queue for a stop.
			this.held = false;
			return;
		}
		if (state.status === "stopped" || state.status === "failed") {
			await host.resume();
		}
		await host.opening;
		if (state.status === "idle") {
			this.held = false;
			this.send([]);
		}
	}

	/**
	 * Stops the agent's turn for the person, marking the turn as one they
	 * stopped, and leaves the conversation open for the next.
	 */
	async cancel(): Promise<void> {
		const { host } = this;
		if (host.state.status === "running") {
			const at = host.now();
			host.log.write({ kind: "stopped", at });
			agentTurn(host.state, at).stopped = at;
			host.changed();
		}
		await this.halt();
	}

	/** Holds `words` and `sent` for when the turn ends, shown as said. */
	private queue(
		words: string,
		sent: Sent[],
		from?: Device,
		marks: Marks = {},
	): void {
		const { host } = this;
		const at = host.now();
		host.log.write({
			kind: "prompt",
			text: words,
			at,
			queued: true,
			...(from === undefined ? {} : { from }),
			...marks,
			...shown(sent),
		});
		host.state.messages.push({
			...said(words, at, sent),
			queued: true,
			...marks,
		});
		host.changed();
	}

	/**
	 * Starts a turn on `fresh`, with every message still queued ahead of it,
	 * as one prompt, or on `fresh` alone, leaving the queue as it is.
	 */
	private send(fresh: Message[], { alone = false } = {}): void {
		const { host } = this;
		const waiting = alone
			? []
			: host.state.messages.filter((each) => each.queued);
		if (waiting.length > 0) {
			delivered(host.state.messages);
			host.log.write({ kind: "sent" });
		}
		// A new turn puts the last one's failure behind it.
		host.set({ status: "running", error: null });
		void this.content([...waiting, ...fresh])
			.then((prompt) => this.connection.prompt(prompt))
			.then(
				(response) => {
					if (response?.usage != null) {
						host.log.write({ kind: "usage", usage: response.usage });
						tally(host.state, response.usage);
					}
					this.ended(null);
				},
				(error: unknown) => this.ended(messageOf(error)),
			);
	}

	/** What `messages` say, as one prompt, for the tree the agent runs in. */
	private content(messages: Message[]) {
		return this.files.content(messages, this.host.cwd ?? this.deps.root);
	}

	/** Settles once no turn is running, or the checkpoint has given up. */
	private idle(): Promise<void> {
		return new Promise((resolve) => {
			const check = () => {
				if (
					this.host.state.status !== "running" ||
					this.host.state.checkpoint !== "asked"
				) {
					off();
					resolve();
				}
			};
			const off = this.host.events.on("changed", check);
			check();
		});
	}

	/** Stops the agent's turn, holding what is queued for the next prompt. */
	private async halt(): Promise<void> {
		this.held = true;
		if (this.connection.asking) {
			this.connection.answer(this.host.state.ask?.id ?? "", {
				type: "dismiss",
			});
		}
		await this.connection.cancel();
	}
}
