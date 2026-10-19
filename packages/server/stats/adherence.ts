import type { ConversationState } from "../conversations";
import type { Log, Storage } from "../storage";
import type { Outcomes } from "./outcomes";
import {
	type Beat,
	type EndState,
	judge,
	splatesCalls,
	type Transcript,
} from "./skill-checks";

/**
 * How closely `splates server`'s conversations follow the splates skill, across
 * projects, in `~/.splates/adherence.jsonl`: a line each time a turn ends and
 * changes how a conversation's checks went, the last one standing for it. It
 * outlives the conversations' logs, which go as archived ones are pruned.
 */
export class Adherence {
	/** The scores last written for each conversation, so a turn that changes none writes nothing. */
	private readonly written = new Map<string, string>();

	readonly log: Log<Judged>;

	constructor(
		/** The machine's storage, or a test's own. */
		storage: Storage,
		/** Where the commits a conversation merged are kept; null to judge without them. */
		private readonly outcomes: Outcomes | null,
	) {
		this.log = storage.log("adherence.jsonl");
	}

	/** Judges `state` as it stands, and keeps the result when it changed. */
	async judge(
		state: ConversationState,
		project: string,
		at: string,
	): Promise<void> {
		const transcript = condense(state);
		const verdicts = judge(transcript, await this.endOf(state, transcript));
		const scores: Scores = Object.fromEntries(
			Object.entries(verdicts)
				.filter(([, each]) => each.length > 0)
				.map(([id, each]) => [
					id,
					{
						passed: each.filter((verdict) => verdict.ok).length,
						failed: each.filter((verdict) => !verdict.ok).length,
					},
				]),
		);
		const key = JSON.stringify([state.skill, scores]);
		if (this.written.get(state.id) === key) {
			return;
		}
		this.written.set(state.id, key);
		const line: Judged = {
			conversation: state.id,
			project,
			agent: state.agent,
			skill: state.skill,
			at,
			scores,
		};
		// Appending, rather than rewriting, keeps two servers judging at once
		// from dropping each other's line.
		await this.log.append(line);
	}

	/** Each conversation's checks as last judged. */
	async list(): Promise<Judged[]> {
		const last = new Map<string, Judged>();
		for (const judged of await this.log.replay()) {
			last.set(judged.conversation, judged);
		}
		return [...last.values()];
	}

	/** What `state` merged, read from the outcomes only once it has merged anything. */
	private async endOf(
		state: ConversationState,
		{ beats }: Transcript,
	): Promise<EndState> {
		const merged = beats.some(
			(each) =>
				each.kind === "run" &&
				each.ok &&
				splatesCalls(each.command).some(({ verb }) => verb === "merge"),
		);
		if (!merged || this.outcomes === null) {
			return { landed: [] };
		}
		const outcomes = await this.outcomes.list();
		return {
			landed: outcomes.flatMap((each) =>
				each.conversation === state.id &&
				each.ended === "merged" &&
				each.commits !== undefined
					? [{ task: each.task, commits: each.commits }]
					: [],
			),
		};
	}
}

/** How each check went over one conversation: the places it applied, passed and failed. */
export type Scores = Record<string, { passed: number; failed: number }>;

/** A conversation's checks as last judged, a line of `~/.splates/adherence.jsonl`. */
export interface Judged {
	conversation: string;
	/** The main tree of the repository it ran in. */
	project: string;
	agent: string;
	/** The splates skill version it started on; null when unknown. */
	skill: string | null;
	/** When it was judged, as an ISO timestamp. */
	at: string;
	scores: Scores;
}

/** A conversation as `skill-checks` reads it: what it said and ran, in order. */
export function condense(state: ConversationState): Transcript {
	const beats: Beat[] = [];
	for (const message of state.messages) {
		if (message.queued) {
			continue;
		}
		if (message.role === "user") {
			beats.push({ kind: "user", text: textOf(message.parts) });
			continue;
		}
		for (const part of message.parts) {
			const last = beats.at(-1);
			if (part.type === "text") {
				if (last?.kind === "say") {
					last.text += part.text;
				} else {
					beats.push({ kind: "say", text: part.text });
				}
			} else if (part.type === "tool" && part.parent === null) {
				if (part.command !== null) {
					beats.push({
						kind: "run",
						command: part.command,
						output: part.output,
						ok: part.status !== "failed",
					});
				} else if (part.kind === "edit" || part.edits.length > 0) {
					const paths = part.edits.map((each) => each.path);
					beats.push({
						kind: "edit",
						paths: paths.length > 0 ? [...new Set(paths)] : part.paths,
					});
				}
			}
		}
	}
	return { beats };
}

function textOf(parts: ConversationState["messages"][number]["parts"]): string {
	return parts
		.flatMap((each) => (each.type === "text" ? [each.text] : []))
		.join("");
}
