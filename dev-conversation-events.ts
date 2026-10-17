import type { Resource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import type { Fs } from "webappwiz/system";
import { Duration, SystemTimer, Throttler, type Timer } from "webappwiz/time";
import type { Conversations } from "./conversations";
import type { Event } from "./events";
import type { Journal } from "./journal";

/**
 * Hands each conversation the events its agent's arbor commands logged: all
 * of them as the server opens the project, then each new one as the journal
 * takes it, so the page shows it in that conversation's thread at once. An
 * event no conversation ran, an external agent's or the page's own, goes
 * nowhere.
 */
export class ConversationEvents implements Resource {
	readonly #seen = new Set<string>();
	readonly #throttler: Throttler;
	#reading = Promise.resolve();
	#watching: Resource | null = null;

	private constructor(
		private readonly journal: Journal,
		private readonly conversations: Conversations,
		private readonly log: Logger,
		timer: Timer,
	) {
		this.#throttler = new Throttler(timer, BEAT);
	}

	/**
	 * Hands each conversation in `conversations` its events, then follows
	 * `arborDir`, where the journal writes, for more.
	 */
	static async follow({
		journal,
		conversations,
		fs,
		arborDir,
		log,
		timer = new SystemTimer(),
	}: {
		journal: Journal;
		conversations: Conversations;
		fs: Fs;
		arborDir: string;
		log: Logger;
		timer?: Timer;
	}): Promise<ConversationEvents> {
		const following = new ConversationEvents(
			journal,
			conversations,
			log,
			timer,
		);
		await following.take(await journal.tail(Number.MAX_SAFE_INTEGER));
		try {
			following.#watching = fs.watch(arborDir, () => following.changed());
			// Anything logged between the read above and the watch starting.
			await following.changed();
		} catch (error) {
			log.error(
				`arbor dev cannot watch ${arborDir}, so arbor's events show in a conversation only once the server restarts: ${String(error)}`,
			);
		}
		return following;
	}

	/**
	 * Hands out what the journal took since the last look, for when it may
	 * have changed; settles once it has.
	 */
	changed(): Promise<void> {
		this.#throttler.call(() => {
			this.#reading = this.#reading
				.then(async () => this.take(await this.journal.recent()))
				.catch((error: unknown) => this.log.error(String(error)));
		});
		return this.#reading;
	}

	dispose(): void {
		this.#watching?.dispose();
		this.#throttler.dispose();
	}

	private async take(events: Event[]): Promise<void> {
		const fresh = events.filter((event) => !this.#seen.has(event.id));
		if (fresh.length === 0) {
			return;
		}
		for (const event of fresh) {
			this.#seen.add(event.id);
		}
		for (const conversation of await this.conversations.list()) {
			const its = fresh.filter(
				(event) => event.conversation === conversation.state.id,
			);
			if (its.length > 0) {
				conversation.set({ events: [...conversation.state.events, ...its] });
			}
		}
	}
}

/** How soon after one read the next may run, while an agent's commands come quickly. */
const BEAT = Duration.ms(50);
