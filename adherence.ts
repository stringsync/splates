import type { Fs } from "webappwiz/system";
import type { ConversationState } from "./conversation-state";
import type { Outcomes } from "./outcomes";
import {
	arborCalls,
	type Beat,
	type EndState,
	judge,
	type Transcript,
} from "./skill-checks";

/**
 * How closely `arbor dev`'s conversations follow the arbor skill, across
 * projects, in `~/.arbor/adherence.jsonl`: a line each time a turn ends and
 * changes how a conversation's checks went, the last one standing for it. It
 * outlives the conversations' logs, which go as archived ones are pruned.
 */
export class Adherence {
	/** The scores last written for each conversation, so a turn that changes none writes nothing. */
	private readonly written = new Map<string, string>();

	constructor(
		/** `~/.arbor/adherence.jsonl`, or a test's own. */
		readonly path: string,
		private readonly fs: Fs,
		/** Where the commits a conversation merged are kept; null to judge without them. */
		private readonly outcomes: Outcomes | null,
	) {}

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
		await this.fs.mkdir(this.path.slice(0, this.path.lastIndexOf("/")));
		await this.fs.append(this.path, `${JSON.stringify(line)}\n`);
	}

	/** Each conversation's checks as last judged. */
	async list(): Promise<Judged[]> {
		const raw = await this.fs.read(this.path).catch(() => "");
		const last = new Map<string, Judged>();
		for (const line of raw.split("\n").filter(Boolean)) {
			try {
				const judged = JSON.parse(line) as Judged;
				last.set(judged.conversation, judged);
			} catch {
				// A torn line loses one judging, not the whole history.
			}
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
				arborCalls(each.command).some(({ verb }) => verb === "merge"),
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

/** A conversation's checks as last judged, a line of `~/.arbor/adherence.jsonl`. */
export interface Judged {
	conversation: string;
	/** The main tree of the repository it ran in. */
	project: string;
	agent: string;
	/** The arbor skill version it started on; null when unknown. */
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
	return { beats, handed: state.handedBy !== null };
}

function textOf(parts: ConversationState["messages"][number]["parts"]): string {
	return parts
		.flatMap((each) => (each.type === "text" ? [each.text] : []))
		.join("");
}
