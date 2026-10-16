import type { Fs } from "webappwiz/system";
import type { Device } from "./conversation-state";
import type { Finding } from "./findings";
import type { TaskUsage } from "./task-log";
import type { DiffSize, MergeFailure, RemoveReason } from "./worktree";

/**
 * Every task that has ended on this machine, across projects, in
 * `~/.arbor/outcomes.jsonl`, oldest first. Unlike the journal it is never
 * trimmed: a trend needs months of it, and a line per task stays small.
 */
export class Outcomes {
	constructor(
		/** `~/.arbor/outcomes.jsonl`, or a test's own. */
		readonly path: string,
		private readonly fs: Fs,
	) {}

	async record(outcome: Outcome): Promise<void> {
		// Appending, rather than rewriting, keeps two agents ending tasks at once
		// from dropping each other's line.
		await this.fs.mkdir(this.path.slice(0, this.path.lastIndexOf("/")));
		await this.fs.append(this.path, `${JSON.stringify(outcome)}\n`);
	}

	async list(): Promise<Outcome[]> {
		const raw = await this.fs.read(this.path).catch(() => "");
		return raw
			.split("\n")
			.filter(Boolean)
			.flatMap((line) => {
				try {
					// A torn line loses one task, not the whole history.
					return [JSON.parse(line) as Outcome];
				} catch {
					return [];
				}
			});
	}
}

/**
 * How one task ended, written as it goes. Its record goes with it, so this is
 * what is left to tell whether tasks are getting easier to land over time.
 */
export interface Outcome {
	/** The main tree of the repository the task was in. */
	project: string;
	task: string;
	/** Where it landed or would have: trunk, or `task/<parent>` for a part. */
	base: string;
	ended: "merged" | "removed";
	/** When it was added, as an ISO timestamp. */
	startedAt: string;
	/** When it was merged or removed, as an ISO timestamp. */
	endedAt: string;
	/** How many times it was handed to a person with questions. */
	questionRounds: number;
	/** How many times it was handed to a person to approve. */
	reviewRounds: number;
	/** Merges that failed on a conflict, the gate, or a base that would not move. */
	failedMerges: number;
	/** `failedMerges` by why each failed. Absent from lines written before it was kept. */
	failedMergesBy?: Partial<Record<MergeFailure, number>>;
	/** The questions its plan asked under `## Blocked`. Absent from older lines. */
	questionsAsked?: number;
	/** Of those, the ones that offered a `(chosen)` pick and were answered with a choice. */
	picksAsked?: number;
	/** Of `picksAsked`, those answered with another choice than the agent's. */
	picksOverturned?: number;
	/** Of `picksAsked`, those answered with the agent's choice but with words added. */
	picksAmended?: number;
	/** The calls its plan made without asking, under `## Assumptions` or challenged out of it. Absent from older lines. */
	assumptionsMade?: number;
	/** Of `assumptionsMade`, those the person challenged. */
	assumptionsChallenged?: number;
	/** The systems its changed files fall in, by name. Absent from older lines. */
	systems?: string[];
	/** How long it waited on a person, escalated, in milliseconds. Absent from older lines. */
	waitedMs?: number;
	/** Why it was removed, when `arbor remove --reason` said; null when merged or unsaid. */
	removedFor?: RemoveReason | null;
	/** For a merge, each commit's message it landed, oldest first. Absent from older lines. */
	commits?: string[];
	/**
	 * How many times the person spoke to its conversation from each layout of
	 * the page while it ran. Absent from older lines.
	 */
	promptsFrom?: Partial<Record<Device, number>>;
	/**
	 * What its own turns used, not the rest of its conversation's. Absent from
	 * older lines, and for a task with no conversation log to read.
	 */
	usage?: TaskUsage;
	/** How long its agent worked, its turns summed, in milliseconds. Absent as `usage` is. */
	workedMs?: number;
	/** What it landed, or for a removed task, what its branch held. Absent from older lines. */
	size?: DiffSize;
	/** What went worse than it could have. Absent from older lines, never read as none. */
	findings?: Finding[];
	/** The `arbor dev` conversation that ended it; null for an external agent. */
	conversation: string | null;
	/** The agent `arbor add --agent` handed it to, if any. */
	agent: string | null;
	/** The model it was handed over with, if any. */
	model: string | null;
}

/**
 * How many prompts the person said from each layout in the conversation
 * logged at `log`, from `since` to `until`: a conversation can outlive the
 * task, or come to it already under way.
 */
export async function promptsFrom(
	log: string,
	fs: Fs,
	since: string,
	until: string,
): Promise<Partial<Record<Device, number>>> {
	const counts: Partial<Record<Device, number>> = {};
	const raw = await fs.read(log).catch(() => "");
	// Each line is written with its kind first, so only prompts are parsed.
	for (const line of raw.split("\n")) {
		if (!line.startsWith('{"kind":"prompt"')) {
			continue;
		}
		const entry = parsed(line);
		if (
			entry?.from !== undefined &&
			entry.at !== undefined &&
			entry.at >= since &&
			entry.at <= until
		) {
			counts[entry.from] = (counts[entry.from] ?? 0) + 1;
		}
	}
	return counts;
}

function parsed(line: string): { from?: Device; at?: string } | null {
	try {
		return JSON.parse(line);
	} catch {
		return null;
	}
}
