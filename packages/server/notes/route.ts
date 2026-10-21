import { createHash } from "node:crypto";
import { relative, resolve } from "node:path";
import { aborts } from "webappwiz/abort";
import { Markdown } from "webappwiz/md";
import type { JudgeFor } from "../auto-pick";
import { ConfigFiles } from "../config";
import {
	type ConversationHost,
	type ConversationState,
	type Route,
	textOf,
} from "../conversations";
import { goalOf, Plans } from "../plans";
import type { Event } from "../records";
import type { Project } from "../server/shared";
import { Notes } from "./notes";
import { pointersOf, ROUTING, tiers } from "./tiers";

/** How much of the message, the Goal and each note body the judge reads. */
const MESSAGE_CHARS = 4000;
const GOAL_CHARS = 2000;
const BODY_CHARS = 2000;
/** How much of the end of the agent's last reply the judge reads, to tell a correction. */
const REPLY_CHARS = 1500;

/** How many of the latest judgments the logged p50 and p95 are over. */
const SAMPLES = 100;

/**
 * Before what the person says goes to the agent, asks the project's judge
 * whether each project note bears on it, in one judgment, and points the
 * agent at those that do and are not in its context already. The judgment
 * is recorded as a `notes attached` event, raw probabilities and all. A
 * conversation chosen for the holdout is judged and recorded alike, but
 * gets nothing attached.
 */
export function routing(
	project: Project,
	{
		judge,
		random = Math.random,
		clock = () => performance.now(),
	}: {
		/** The judge to ask, as the project's creds give it, for whom it judges. */
		judge: JudgeFor;
		/** Draws the holdout, in [0, 1). */
		random?: () => number;
		/** Times the judge, in milliseconds. */
		clock?: () => number;
	},
): Route {
	const took: number[] = [];
	return async (conversation, said) => {
		const { state } = conversation;
		const words = said
			.map(textOf)
			.filter((each) => each.trim() !== "")
			.join("\n\n");
		if (words === "") {
			return null;
		}
		const root = project.git.root;
		const config = await new ConfigFiles(project.fs).read(root);
		const listed = await new Notes(project.fs).list(root, config);
		if (listed.length === 0) {
			return null;
		}
		const asker = await judge({
			task: state.task,
			conversation: state.id,
			purpose: "notes",
		});
		if (asker === null) {
			return null;
		}
		const holdout = heldOut(conversation, random);
		const tree = conversation.cwd ?? root;
		const notes = await Promise.all(
			listed.map(async (note) => {
				const path = relative(root, note.path);
				const text = await readEither(project, resolve(tree, path), note.path);
				return {
					path,
					description: note.description,
					body:
						text === null
							? ""
							: Markdown.parse(text.replace(/\r\n/g, "\n")).body,
					hash: text === null ? null : hashOf(text),
				};
			}),
		);
		const [goal, read] = await Promise.all([
			goalIn(project, state, conversation.cwd),
			readsIn(project, state),
		]);
		const signal = AbortSignal.timeout(ROUTING.timeout.ms);
		const started = clock();
		const verdict = await aborts
			.race(
				signal,
				asker.judge(
					{
						state: {
							message: words.slice(0, MESSAGE_CHARS),
							goal: goal.slice(0, GOAL_CHARS) || null,
							reply: replyOf(state).slice(-REPLY_CHARS) || null,
							notes: Object.fromEntries(
								notes.map((note, index) => [
									`n${index}`,
									{
										path: note.path,
										description: note.description,
										body: note.body.slice(0, BODY_CHARS),
									},
								]),
							),
						},
						questions: {
							...Object.fromEntries(
								notes.map((_, index) => [`n${index}`, question(`n${index}`)]),
							),
							[CORRECTS]: CORRECTION,
						},
					},
					{ signal },
				),
			)
			.catch((error: unknown) => {
				project.log.error(
					`notes: no pointers for conversation ${state.id}: ${error instanceof Error ? error.message : String(error)}`,
				);
				return null;
			});
		const ms = Math.round(clock() - started);
		if (verdict === null) {
			return null;
		}
		project.log.info(`notes: judged in ${ms}ms (${spread(took, ms)})`);
		const tiered = tiers(
			notes.map((note, index) => {
				const before = read.get(note.path);
				const inContext = before !== undefined && before === note.hash;
				return {
					path: note.path,
					description: note.description,
					probability: verdict.answers.get(`n${index}`) ?? 0,
					inContext,
					updated: before !== undefined && !inContext,
				};
			}),
		);
		const corrects = verdict.answers.get(CORRECTS);
		await project.journal
			.in(state.id)
			.record("notes attached", state.task, async () => {}, {
				notes: tiered.map(({ description: _, ...note }) => note),
				holdout,
				ms,
				...(corrects === undefined ? {} : { corrects }),
				dollars: verdict.dollars ?? null,
			})
			.catch((error: unknown) => project.log.error(String(error)));
		return holdout ? null : pointersOf(tiered);
	};
}

/** The id of the question whether the message corrects the agent, for the Stats page's correction rate. */
const CORRECTS = "corrects";

const CORRECTION = {
	type: "noul" as const,
	instructions:
		"Does `message` correct the agent: say that its work or its `reply` was wrong, or not what was asked, and ask it to redo or undo something?",
	criteria: {
		true: "The person points out a mistake, a misunderstanding or something the agent should not have done, or repeats an instruction it did not follow.",
		false:
			"The message asks for something new, answers a question, approves, or adds detail the agent could not have known.",
	},
};

/** What the agent said in its last turn, in its own words; "" before it has said anything. */
function replyOf(state: ConversationState): string {
	const last = state.messages.findLast((message) => message.role === "agent");
	return (last?.parts ?? [])
		.flatMap((part) => (part.type === "text" ? [part.text] : []))
		.join("")
		.trim();
}

/** The question asked of the note at `notes.<id>`. */
function question(id: string) {
	return {
		type: "noul" as const,
		instructions: `Does the project note \`notes.${id}\` bear on what \`message\` asks, so that an agent doing it, toward \`goal\` when there is one, should read the note before acting?`,
		criteria: {
			true: "The note's conventions, decisions or facts would change how the agent does what the message asks, or the message is about what the note covers.",
			false:
				"The note is about something the message does not touch, or touches only in passing.",
		},
	};
}

/**
 * Whether `conversation` is held back from pointers: drawn at random the
 * first time, and kept in its log.
 */
function heldOut(
	conversation: ConversationHost,
	random: () => number,
): boolean {
	const kept = conversation.state.notesHoldout;
	if (kept !== null) {
		return kept;
	}
	const holdout = random() < ROUTING.holdout;
	conversation.log.write({ kind: "notes-holdout", holdout });
	conversation.set({ notesHoldout: holdout });
	return holdout;
}

/** What the task's `SPLATES.md` says done means; "" for none. */
async function goalIn(
	project: Project,
	state: ConversationState,
	cwd: string | null,
): Promise<string> {
	if (state.task === null || cwd === null) {
		return "";
	}
	return goalOf((await new Plans(project.fs).read(cwd)) ?? "");
}

/**
 * The notes the conversation's own agent has read and still holds, by path,
 * each with the hash of its content as read: the last read of each, unless
 * a compaction came since. A subagent's read is in its own context only.
 */
async function readsIn(
	project: Project,
	state: ConversationState,
): Promise<Map<string, string | null>> {
	const compacted = state.messages
		.flatMap((message) => message.parts)
		.flatMap((part) =>
			part.type === "compaction" && part.status !== "failed" && part.at !== null
				? [part.at]
				: [],
		)
		.sort()
		.at(-1);
	const reads = new Map<string, string | null>();
	const events = await project.journal.recent().catch(() => [] as Event[]);
	for (const event of events) {
		if (
			event.action === "note read" &&
			event.conversation === state.id &&
			event.reason === null &&
			!event.subagent &&
			(compacted === undefined || event.at > compacted)
		) {
			reads.set(event.path, event.hash);
		}
	}
	return reads;
}

/** The text at the first of `paths` there is; null for none. */
async function readEither(
	project: Project,
	...paths: string[]
): Promise<string | null> {
	for (const path of paths) {
		if (await project.fs.exists(path)) {
			return project.fs.read(path);
		}
	}
	return null;
}

/** As `NoteReads` hashes a note's content. */
function hashOf(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

/** The p50 and p95 of the latest judgments, `ms` among them. */
function spread(took: number[], ms: number): string {
	took.push(ms);
	if (took.length > SAMPLES) {
		took.shift();
	}
	const sorted = [...took].sort((one, other) => one - other);
	const at = (share: number) =>
		sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))];
	return `p50 ${at(0.5)}ms, p95 ${at(0.95)}ms over ${sorted.length}`;
}
