import type { AsyncResource, Resource } from "core/disposable";
import { type Clock, Duration, SystemClock, SystemTimer } from "core/time";
import { type ConversationList, SERVER_TOLD } from "../conversations";
import type { Machine, MachineReading } from "../workers";
import { strained } from "../workers";
import type { Project } from "./project-types";

export { eventWaitOf } from "../conversations";

import { eventWaitOf } from "../conversations";

/** Resumes conversations when their requested task finishes or machine idle period elapses. */
export class EventWaitWatch implements AsyncResource {
	private readonly clock: Clock;
	private readonly idleSince = new Map<string, Duration>();
	private readonly sampledAt = new Map<string, Duration>();
	private readonly answered = new Set<string>();
	private running = Promise.resolve();
	private disposed = false;
	private interval: Resource | null = null;

	constructor(
		private readonly deps: {
			conversations: ConversationList;
			read: () => Promise<MachineReading>;
			/** null means still running; a terminal result also covers an unknown task. */
			taskResult: (slug: string) => Promise<string | null>;
			log: { error(message: string): void };
			clock?: Clock;
		},
	) {
		this.clock = deps.clock ?? new SystemClock();
	}

	/** Starts notifications for this project's conversations; returns the stop function. */
	static begin(
		project: Project,
		conversations: ConversationList,
		machine: Machine,
	): () => void {
		const watch = new EventWaitWatch({
			conversations,
			read: () => machine.read(),
			taskResult: async (slug) => {
				if ((await project.service.list()).some(({ task }) => task === slug)) {
					return null;
				}
				const event = (await project.journal.all()).findLast(
					(event) =>
						event.task === slug &&
						event.reason === null &&
						(event.action === "merge" || event.action === "remove"),
				);
				return event === undefined
					? `Task ${slug} was not found; the wait has stopped.`
					: `Task ${slug} ${event.action === "merge" ? "merged" : "was removed"}.`;
			},
			log: project.log,
		});
		watch.start();
		return () => void watch.disposeAsync();
	}

	start(): void {
		this.interval = new SystemTimer().setInterval(
			() => void this.sweep(),
			Duration.secs(5),
		);
		void this.sweep();
	}

	sweep(): Promise<void> {
		this.running = this.running
			.then(async () => {
				if (this.disposed) {
					return;
				}
				const live = new Set<string>();
				for (const conversation of await this.deps.conversations.list()) {
					const { state } = conversation;
					const request = eventWaitOf(state.messages.at(-1));
					if (state.archived || !canResumeWait(state) || request === null) {
						continue;
					}
					const key = `${state.id}:${state.messages.length}`;
					live.add(key);
					if (this.answered.has(key)) {
						continue;
					}
					let response: string | null;
					if (request.type === "task") {
						response = await this.deps.taskResult(request.task);
					} else {
						const reading = await this.deps.read();
						const now = this.clock.now();
						const last = this.sampledAt.get(key);
						this.sampledAt.set(key, now);
						if (
							last !== undefined &&
							now.subtract(last).isGreaterThan(Duration.secs(15))
						) {
							this.idleSince.delete(key);
						}
						if (strained(reading)) {
							this.idleSince.delete(key);
							continue;
						}

						const since = this.idleSince.get(key) ?? now;
						this.idleSince.set(key, since);
						response = now
							.subtract(since)
							.isGreaterThanOrEqual(request.duration)
							? `The machine has stayed idle for ${request.duration.ms}ms (sampled every 5 seconds).`
							: null;
					}
					// Reading load or task history can yield to a newer reply or archive action.
					const current = conversation.state;
					if (
						this.disposed ||
						current.archived ||
						!canResumeWait(current) ||
						key !== `${current.id}:${current.messages.length}` ||
						current.messages.at(-1) !== state.messages.at(-1)
					) {
						continue;
					}
					if (response !== null) {
						this.answered.add(key);
						try {
							await conversation.prompt(
								`[SPLATES WAIT COMPLETE]\n\n${response}`,
								[],
								undefined,
								{ told: SERVER_TOLD },
							);
						} catch (error) {
							this.answered.delete(key);
							this.deps.log.error(String(error));
						}
					}
				}
				for (const key of this.idleSince.keys()) {
					if (!live.has(key)) {
						this.idleSince.delete(key);
					}
				}
				for (const key of this.sampledAt.keys()) {
					if (!live.has(key)) {
						this.sampledAt.delete(key);
					}
				}
				for (const key of this.answered) {
					if (!live.has(key)) {
						this.answered.delete(key);
					}
				}
			})
			.catch((error: unknown) => {
				this.idleSince.clear();
				this.deps.log.error(String(error));
			});
		return this.running;
	}

	async disposeAsync(): Promise<void> {
		this.disposed = true;
		this.interval?.dispose();
		await this.running;
	}
}

/** Whether an idle or idle-stopped conversation can still be resumed by its event wait. */
function canResumeWait(state: {
	status: string;
	checkpoint?: string | null;
}): boolean {
	return (
		(state.status === "idle" || state.status === "stopped") &&
		state.checkpoint == null
	);
}
