import { Duration, SystemTimer } from "webappwiz/time";
import type { Needing } from "../needs";
import type { Settings } from "./settings";

/** Something a row did worth telling the person about, away from the page. */
export interface Notice {
	row: Needing;
	title: string;
	body: string;
}

/** What the last look saw of a row. */
interface Seen {
	kind: Needing["need"]["kind"];
	quiet: boolean;
}

/**
 * Tells the person, with a browser notification and the sound they chose,
 * when an agent comes to wait on them, finishes its turn, or goes quiet, each
 * as `settings` say.
 */
export class Notifier {
	/** By row, what the last look saw; null before the first. */
	private seen: Map<string, Seen> | null = null;

	constructor(private readonly settings: Settings) {}

	/**
	 * Compares `rows`, named by `name`, with the last look at `now`, and
	 * returns what changed worth telling, of the kinds the settings ask for: a
	 * row that came to wait, a conversation that finished its turn, and one
	 * running with no word for the quiet time. The first look tells nothing,
	 * since it has nothing to compare.
	 */
	look(rows: Needing[], name: (row: Needing) => string, now: number): Notice[] {
		const after = Duration.mins(this.settings.get("notifications.quietAfter"));
		const before = this.seen;
		this.seen = new Map(
			rows.map((row) => [
				keyOf(row),
				{ kind: row.need.kind, quiet: quiet(row, now, after) },
			]),
		);
		if (before === null) {
			return [];
		}
		const wanted = {
			waiting: this.settings.get("notifications.waiting"),
			finished: this.settings.get("notifications.finished"),
			quiet: this.settings.get("notifications.quiet"),
		};
		return rows.flatMap((row) => {
			const was = before.get(keyOf(row));
			const is = this.seen?.get(keyOf(row));
			if (was === undefined || is === undefined) {
				return [];
			}
			const need = row.need;
			if (need.kind === "waiting" && was.kind !== "waiting") {
				return wanted.waiting
					? [
							{
								row,
								title: `${name(row)} ${need.why === "failed" ? "failed" : "needs you"}`,
								body: need.subject,
							},
						]
					: [];
			}
			if (
				row.conversation !== null &&
				need.kind === "idle" &&
				(was.kind === "working" || was.kind === "assuming")
			) {
				return wanted.finished
					? [{ row, title: `${name(row)} finished`, body: lastWords(row) }]
					: [];
			}
			if (is.quiet && !was.quiet && wanted.quiet) {
				return [
					{
						row,
						title: `${name(row)} has gone quiet`,
						body: `No word for ${after.mins} minutes`,
					},
				];
			}
			return [];
		});
	}

	/**
	 * Shows `notices` as browser notifications, while on and, unless the
	 * settings say otherwise, the page is not in front of the person, each
	 * opening its row with `open` when clicked; with a sound once when it is
	 * on.
	 */
	show(notices: Notice[], open: (row: Needing) => void): void {
		if (
			notices.length === 0 ||
			!this.settings.get("notifications.on") ||
			(document.hasFocus() && !this.settings.get("notifications.inFront"))
		) {
			return;
		}
		for (const notice of notices) {
			const shown = new Notification(notice.title, {
				body: notice.body,
				// One per row: a newer one replaces what it said before.
				tag: keyOf(notice.row),
			});
			shown.onclick = () => {
				window.focus();
				open(notice.row);
				shown.close();
			};
		}
		if (this.settings.get("notifications.sound")) {
			chime();
		}
	}
}

function keyOf(row: Needing): string {
	return row.conversation !== null
		? `conversation ${row.conversation.id}`
		: `task ${row.task?.task}`;
}

/** Whether `row` is a conversation running with no word for `after`. */
function quiet(row: Needing, now: number, after: Duration): boolean {
	const conversation = row.conversation;
	if (conversation?.status !== "running") {
		return false;
	}
	const last = conversation.messages.at(-1);
	const moved = last?.until ?? last?.at ?? null;
	// A log too old to say never counts as quiet.
	return moved !== null && now - Date.parse(moved) >= after.ms;
}

/** The start of what the agent said last, or a stand-in when it said nothing. */
function lastWords(row: Needing): string {
	const said = row.conversation?.messages
		.findLast((message) => message.role === "agent")
		?.parts.findLast((part) => part.type === "text");
	const text = said?.type === "text" ? said.text.trim() : "";
	if (text === "") {
		return "Its turn is over";
	}
	return text.length > 140 ? `${text.slice(0, 139)}…` : text;
}

/** Two short rising tones, made rather than loaded. */
function chime(): void {
	if (typeof AudioContext === "undefined") {
		return;
	}
	const audio = new AudioContext();
	const gain = audio.createGain();
	gain.connect(audio.destination);
	gain.gain.setValueAtTime(0.0001, audio.currentTime);
	for (const [at, pitch] of [
		[0, 660],
		[0.12, 880],
	] as const) {
		const tone = audio.createOscillator();
		tone.frequency.value = pitch;
		tone.connect(gain);
		const start = audio.currentTime + at;
		gain.gain.exponentialRampToValueAtTime(0.15, start + 0.01);
		gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.11);
		tone.start(start);
		tone.stop(start + 0.12);
	}
	new SystemTimer().setTimeout(() => void audio.close(), Duration.ms(500));
}
