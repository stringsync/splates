import { relative, resolve } from "node:path";
import { aborts } from "webappwiz/abort";
import { Markdown } from "webappwiz/md";
import { Duration } from "webappwiz/time";
import type { JudgeFor } from "../auto-pick";
import { ConfigFiles } from "../config";
import type { ConversationState, Tool, Weigh } from "../conversations";
import type { Event, NoteApplied } from "../records";
import type { Project } from "../server/shared";
import { notesRead } from "./match";
import { Notes } from "./notes";

/** How much of each note body, and of the turn's actions, the judge reads. */
const BODY_CHARS = 2000;
const ACTIONS = 40;
const ACTION_CHARS = 300;
const REPLY_CHARS = 2000;

/** How long a turn's judgment may take before it is given up. */
const TIMEOUT = Duration.secs(30);

/**
 * After a turn, asks the project's judge, of each note the agent read in it,
 * whether what it did applied what the note says, in one judgment, and
 * records each answer as a `note applied` event with the tier the note's
 * pointer had. A note read often and seldom applied is a distractor, for the
 * Stats page to show. With no judge it does nothing, so spends nothing.
 */
export function weighing(
	project: Project,
	{ judge }: { judge: JudgeFor },
): Weigh {
	return async (conversation, since) => {
		const { state } = conversation;
		const root = project.git.root;
		const turn = state.messages.filter(
			(message) =>
				message.role === "agent" && message.at !== null && message.at >= since,
		);
		const tools = turn.flatMap((message) =>
			message.parts.filter((part): part is Tool => part.type === "tool"),
		);
		if (tools.length === 0) {
			return;
		}
		const config = await new ConfigFiles(project.fs).read(root);
		const listed = await new Notes(project.fs).list(root, config);
		const read = [
			...new Set(
				tools.flatMap((tool) =>
					notesRead(tool, listed, root, conversation.cwd),
				),
			),
		];
		if (read.length === 0) {
			return;
		}
		const asker = await judge({ task: state.task, conversation: state.id });
		if (asker === null) {
			return;
		}
		const notes = await Promise.all(
			read.map(async (note) => {
				const path = relative(root, note.path);
				const text = await readEither(
					project,
					resolve(conversation.cwd ?? root, path),
					note.path,
				);
				return {
					path,
					body:
						text === null
							? ""
							: Markdown.parse(text.replace(/\r\n/g, "\n")).body.slice(
									0,
									BODY_CHARS,
								),
				};
			}),
		);
		const signal = AbortSignal.timeout(TIMEOUT.ms);
		const verdict = await aborts
			.race(
				signal,
				asker.judge(
					{
						state: {
							actions: tools.slice(-ACTIONS).map(actionOf),
							edited: [
								...new Set(
									tools.flatMap((tool) => tool.edits.map((edit) => edit.path)),
								),
							],
							reply: replyOf(turn).slice(-REPLY_CHARS),
							notes: Object.fromEntries(
								notes.map((note, index) => [
									`n${index}`,
									{ path: note.path, body: note.body },
								]),
							),
						},
						questions: Object.fromEntries(
							notes.map((_, index) => [`n${index}`, question(`n${index}`)]),
						),
					},
					{ signal },
				),
			)
			.catch((error: unknown) => {
				project.log.error(
					`notes: not weighed for conversation ${state.id}: ${error instanceof Error ? error.message : String(error)}`,
				);
				return null;
			});
		if (verdict === null) {
			return;
		}
		const pointed = await pointersIn(project, state);
		for (const [index, note] of notes.entries()) {
			await project.journal
				.in(state.id)
				.record("note applied", state.task, async () => {}, {
					path: note.path,
					probability: verdict.answers.get(`n${index}`) ?? 0,
					tier: pointed.get(note.path) ?? "unprompted",
				})
				.catch((error: unknown) => project.log.error(String(error)));
		}
	};
}

/** The question asked of the note at `notes.<id>`. */
function question(id: string) {
	return {
		type: "noul" as const,
		instructions: `The agent read the project note \`notes.${id}\` this turn. Do its \`actions\`, the files it \`edited\` and its \`reply\` apply what the note says?`,
		criteria: {
			true: "The agent did something the note's conventions, decisions or facts call for, or held back from something they rule out.",
			false:
				"Nothing the agent did follows from the note: it would have done the same without reading it.",
		},
	};
}

/** A tool call in a line: what it is and what it ran or touched. */
function actionOf(tool: Tool): string {
	const what = tool.command ?? tool.target ?? tool.paths.join(" ");
	return `${tool.title}${what && what !== tool.title ? `: ${what}` : ""}`.slice(
		0,
		ACTION_CHARS,
	);
}

/** What the agent said in the turn, in its own words. */
function replyOf(turn: ConversationState["messages"]): string {
	return turn
		.flatMap((message) => message.parts)
		.flatMap((part) => (part.type === "text" ? [part.text] : []))
		.join("")
		.trim();
}

/**
 * The tier each note was last attached at in the conversation, by path: a
 * note the router judged but attached nothing of is not among them.
 */
async function pointersIn(
	project: Project,
	state: ConversationState,
): Promise<Map<string, NoteApplied["tier"]>> {
	const tiers = new Map<string, NoteApplied["tier"]>();
	const events = await project.journal.recent().catch(() => [] as Event[]);
	for (const event of events) {
		if (
			event.action === "notes attached" &&
			event.conversation === state.id &&
			event.reason === null
		) {
			for (const note of event.notes) {
				if (note.tier !== null) {
					tiers.set(note.path, note.tier);
				}
			}
		}
	}
	return tiers;
}

/** The text at the first of `paths` there is, as the agent read it in its own tree; null for none. */
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
