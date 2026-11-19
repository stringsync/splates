import { type AsyncResource, Disposer } from "core/disposable";
import { Duration, SystemTimer } from "core/time";
import type { Conversation } from "../conversations";
import { type ConversationList, SERVER_TOLD } from "../conversations";
import type { Message } from "../conversations/state";
import { AUTO_ALLOWED, RUN_ALLOWED, stretches } from "../plans";
import { recOf, retryOf } from "../plans/run-command";
import type { Machine, MachineReading } from "../workers";
import { strained } from "../workers";
import type { Project } from "./project";

/** What the server tells the agent after `RUN_ALLOWED`, the page showing it as auto-allowed. */
export function autoAllowed(reading: MachineReading): string {
	const share = (each: number) => `${Math.round(each * 100)}%`;
	return `${RUN_ALLOWED}\n\n${AUTO_ALLOWED}: the card asked only because the machine was busy, and it no longer is (CPU ${share(reading.cpu)}, memory ${share(reading.memory)}).`;
}

/**
 * The command of the run-command card `message` ends with when the agent
 * says the machine's load was its only reason for asking (`Reason: busy`);
 * null for any other card, any other reason, none at all, and a card that
 * is not the reply's last.
 */
export function busyCommandOf(message: Message | undefined): string | null {
	if (message === undefined || message.role !== "agent") {
		return null;
	}
	const text = message.parts
		.flatMap((part) => (part.type === "text" ? [part.text] : []))
		.join("\n\n");
	const last = stretches(text).at(-1);
	if (last === undefined || last.type !== "permission") {
		return null;
	}
	const card = last.permission;
	if (
		card.action !== "run-command" ||
		card.reason !== "busy" ||
		card.command === undefined ||
		card.command === "" ||
		recOf(card.command) ||
		retryOf(card.command) !== null
	) {
		return null;
	}
	return card.command;
}

/**
 * Answers run-command cards the agent asked only because the machine was
 * busy (`Reason: busy`) once it no longer is, so the person need not.
 * `BusyRunWatch.begin` starts it for a project, and it does nothing unless
 * the project sets `autoAllowBusyRuns`. Any other card waits for the person.
 */
export class BusyRunWatch implements AsyncResource {
	private readonly timer = new SystemTimer();
	private readonly disposer = new Disposer();
	private readonly answered = new Set<string>();
	private running = Promise.resolve();
	private disposed = false;

	constructor(
		private readonly deps: {
			enabled: () => boolean;
			conversations: ConversationList;
			read: () => Promise<MachineReading>;
			log: { error(message: string): void };
		},
	) {}

	/**
	 * Starts watching `project`'s conversations, reading `machine`; returns
	 * what stops it.
	 */
	static begin(
		project: Project,
		conversations: ConversationList,
		machine: Machine,
	): () => void {
		const watch = new BusyRunWatch({
			enabled: () => project.config.autoAllowBusyRuns,
			conversations,
			read: () => machine.read(),
			log: project.log,
		});
		watch.start();
		return () => void watch.disposeAsync();
	}

	private start(): void {
		this.disposer.use(
			this.timer.setInterval(() => void this.sweep(), Duration.secs(30)),
		);
	}

	/** Answers each waiting busy-only card, if the machine is not busy now. */
	sweep(): Promise<void> {
		this.running = this.running
			.then(async () => {
				if (this.disposed || !this.deps.enabled()) {
					return;
				}
				const waiting = (await this.deps.conversations.list()).filter((each) =>
					this.waiting(each),
				);
				if (waiting.length === 0) {
					return;
				}
				for (const conversation of waiting) {
					// A reading per answer: the command before it may have loaded the machine.
					const reading = await this.deps.read();
					if (strained(reading)) {
						return;
					}
					const key = this.key(conversation);
					this.answered.add(key);
					await conversation
						.prompt(autoAllowed(reading), [], undefined, { told: SERVER_TOLD })
						.catch((error: unknown) => {
							this.answered.delete(key);
							this.deps.log.error(String(error));
						});
				}
			})
			.catch((error: unknown) => this.deps.log.error(String(error)));
		return this.running;
	}

	private key(conversation: Conversation): string {
		return `${conversation.state.id}:${conversation.state.messages.length}`;
	}

	private waiting(conversation: Conversation): boolean {
		const { state } = conversation;
		return (
			!state.archived &&
			state.status === "idle" &&
			!this.answered.has(this.key(conversation)) &&
			busyCommandOf(state.messages.at(-1)) !== null
		);
	}

	async disposeAsync(): Promise<void> {
		this.disposed = true;
		this.disposer.dispose();
		await this.running;
	}
}
