import { Duration, Throttler } from "core/time";
import type { ConversationDeps, ConversationHost } from "./host";
import type { Progress, ProgressState } from "./state";

/** The fewest a card goes between two published updates; a burst inside it shows as one. */
export const PUBLISH_GAP = Duration.secs(2);
/** The notes a card keeps of earlier updates. */
const HISTORY = 20;
/** The cards a conversation keeps; reporting another drops the oldest finished one. */
const CARDS = 10;
/** The longest a note or title is; the rest is cut. */
const NOTE_LENGTH = 200;
const TITLE_LENGTH = 80;

/** What an agent reports with `splates progress`. */
export interface ProgressUpdate {
	id: string;
	title?: string;
	state?: ProgressState;
	percent?: number | null;
	note?: string;
}

/**
 * Puts `progress` in `list` in place of the card of its id, or last. Past
 * `CARDS`, the oldest finished card goes, else the oldest.
 */
export function applyProgress(list: Progress[], progress: Progress): void {
	const at = list.findIndex((each) => each.id === progress.id);
	if (at >= 0) {
		list[at] = progress;
		return;
	}
	list.push(progress);
	if (list.length > CARDS) {
		const finished = list.findIndex((each) => each.state !== "running");
		list.splice(finished >= 0 ? finished : 0, 1);
	}
}

/** Stops each running card in `list`, as its agent's process ending does, at `at`. */
export function endProgress(list: Progress[], at: string | null): void {
	for (const [index, card] of list.entries()) {
		if (card.state === "running") {
			list[index] = {
				...card,
				state: "stopped",
				updatedAt: at ?? card.updatedAt,
			};
		}
	}
}

/**
 * Publishes a conversation's progress cards, at most once per `PUBLISH_GAP`
 * per card, so a burst of updates reaches the page and listeners as its first
 * and last. A card finishing publishes at once.
 */
export class ConversationProgress {
	/** The newest card per id, published or waiting its turn. */
	private readonly reported = new Map<string, Progress>();
	private readonly throttlers = new Map<string, Throttler>();

	constructor(
		private readonly host: ConversationHost,
		private readonly deps: ConversationDeps,
	) {}

	/** Takes an update; answers the card as it stands, published or not yet. */
	report(update: ProgressUpdate): Progress {
		const id = tidy(update.id, TITLE_LENGTH);
		const now = this.host.now();
		const base = this.reported.get(id) ?? this.card(id);
		const next: Progress = {
			id,
			title: tidy(update.title ?? base?.title ?? id, TITLE_LENGTH) || id,
			state: update.state ?? base?.state ?? "running",
			percent:
				update.percent === undefined
					? (base?.percent ?? null)
					: update.percent === null
						? null
						: clamp(update.percent),
			note:
				update.note === undefined
					? (base?.note ?? "")
					: tidy(update.note, NOTE_LENGTH),
			startedAt: base?.startedAt ?? now,
			updatedAt: now,
			history: base?.history ?? [],
		};
		if (next.state === "done" && update.percent === undefined) {
			next.percent = 100;
		}
		// Nothing the page would show differently: not an update.
		if (base !== undefined && same(base, next)) {
			return base;
		}
		const finishing = next.state !== "running" && base?.state !== next.state;
		this.reported.set(id, next);
		const throttler = this.throttler(id);
		throttler.call(() => this.publish(id));
		if (finishing) {
			throttler.flush();
		}
		return next;
	}

	/**
	 * Finishes each running card whose id is a background command that has
	 * ended, so a card does not hang on `running` over a command that died.
	 */
	settle(): void {
		for (const command of this.host.state.background) {
			if (command.state === "running") {
				continue;
			}
			const card = this.reported.get(command.id) ?? this.card(command.id);
			if (card?.state === "running") {
				this.report({
					id: command.id,
					state: command.state === "completed" ? "done" : "failed",
				});
			}
		}
	}

	/** Its agent's process ended: what was waiting is dropped, and running cards stop. */
	end(): void {
		this.forget();
		endProgress(this.host.state.progress, this.host.now());
	}

	/** Drops every card, for an archived conversation. */
	clear(): void {
		this.forget();
		this.host.state.progress.length = 0;
	}

	dispose(): void {
		this.forget();
	}

	private forget(): void {
		for (const throttler of this.throttlers.values()) {
			throttler.dispose();
		}
		this.throttlers.clear();
		this.reported.clear();
	}

	private card(id: string): Progress | undefined {
		return this.host.state.progress.find((each) => each.id === id);
	}

	private throttler(id: string): Throttler {
		let throttler = this.throttlers.get(id);
		if (throttler === undefined) {
			throttler = new Throttler(this.deps.timer, PUBLISH_GAP);
			this.throttlers.set(id, throttler);
		}
		return throttler;
	}

	/** Puts the newest card of `id` on the card list and in the log, its old note into history. */
	private publish(id: string): void {
		const next = this.reported.get(id);
		if (next === undefined) {
			return;
		}
		const shown = this.card(id);
		const history =
			shown !== undefined && shown.note !== "" && shown.note !== next.note
				? [...shown.history, { at: shown.updatedAt, note: shown.note }]
				: (shown?.history ?? []);
		const card = { ...next, history: history.slice(-HISTORY) };
		this.reported.set(id, card);
		this.host.log.write({ kind: "progress", progress: card });
		applyProgress(this.host.state.progress, card);
		this.host.changed();
	}
}

/** Whether two cards read the same, whatever time they were reported at. */
function same(before: Progress, after: Progress): boolean {
	return (
		before.title === after.title &&
		before.state === after.state &&
		before.percent === after.percent &&
		before.note === after.note
	);
}

/** One line, whitespace folded, cut at `length`. */
function tidy(text: string, length: number): string {
	const line = text.replace(/\s+/g, " ").trim();
	return line.length <= length ? line : `${line.slice(0, length - 1)}…`;
}

function clamp(percent: number): number {
	return Math.min(100, Math.max(0, Math.round(percent)));
}
