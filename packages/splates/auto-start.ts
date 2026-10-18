import {
	type AutoPick,
	JUDGE_CREDS,
	type Judge,
	judgeFrom,
	pick,
} from "./auto-pick";
import type { Conversation, Picked } from "./conversation";
import type { Conversations } from "./conversations";
import type { Project } from "./dev-project";
import { effortSettings } from "./effort";
import { Roster, splatesHome } from "./roster";

/** The cred Auto offers to ask for when no judge's is kept: Jev's, the one key. */
const JUDGE_KEY = JUDGE_CREDS.jev[0];

/** What {@link JUDGE_KEY} is for, as the Creds page shows it. */
const PURPOSE =
	"Auto asks TypeSafe's Jev how hard a first prompt is, to start it on the cheapest model that can do it; without a key every Auto start goes to the default weight.";

/** How to get {@link JUDGE_KEY}, as the Creds page shows it. */
const INSTRUCTIONS = `1. Open [TypeSafe](https://typesafe.ai) and sign in.
2. Create an API key.
3. Paste it here.`;

/**
 * Starts a conversation on what Auto picks for `prompt`: the agent, its
 * model, and its thinking level as the agent's `thought_level` setting takes
 * it, through `start`, which knows the tree it runs in. It answers before the
 * judge does, on what Auto picks with none, so the page opens the thread at
 * once; the agent opens on the judge's pick, which a prompt said meanwhile
 * waits on. Logs the pick in the conversation as splates's own line, and,
 * with no judge to ask, asks once on the Creds page for the key one needs.
 */
export async function startAuto({
	project,
	conversations,
	prompt,
	task,
	start,
	now = new Date(),
}: {
	project: Project;
	conversations: Conversations;
	prompt: string;
	/** The task the conversation starts in, for its events; null for the main tree. */
	task: string | null;
	start: (
		agent: string,
		opts: {
			model?: string;
			settings: Record<string, string>;
			picking: Promise<Picked<string>>;
		},
	) => Promise<Conversation>;
	now?: Date;
}): Promise<Conversation> {
	const offered = await conversations.settings();
	const input = {
		prompt,
		agents: await new Roster(`${splatesHome(project.ps)}/agents.json`, {
			fs: project.fs,
		}).agents(),
		offered,
		limits: await conversations.limits(),
		now,
	};
	const fallback = await pick({ ...input, judge: null });
	const judging = judgeFrom(project.creds.credentials).then(async (judge) => ({
		judge,
		picked: judge === null ? fallback : await pick({ ...input, judge }),
	}));
	const opened = (picked: AutoPick): Picked<string> => ({
		agent: picked.agent,
		...(picked.model === undefined ? {} : { model: picked.model }),
		settings: effortSettings(picked.effort, offered[picked.agent] ?? []),
	});
	const starting = opened(fallback);
	const conversation = start(starting.agent, {
		...starting,
		// Logged before the agent opens on it, so its line leads what it says.
		picking: judging.then(
			async ({ judge, picked }) => {
				await conversation
					.then((started) => logPick(project, started.id, task, picked, judge))
					.catch((error: unknown) => project.log.error(String(error)));
				return opened(picked);
			},
			(error: unknown) => {
				project.log.error(`Auto could not ask its judge: ${String(error)}`);
				return opened(fallback);
			},
		),
	});
	return conversation;
}

/**
 * Logs Auto's pick in the conversation, and, with no judge to ask, the
 * request for the key one needs.
 */
async function logPick(
	project: Project,
	conversation: string,
	task: string | null,
	picked: AutoPick,
	judge: Judge | null,
): Promise<void> {
	const journal = project.journal.in(conversation);
	await journal.record("auto", task, async () => {}, {
		agent: picked.agent,
		model: picked.model ?? null,
		effort: picked.effort ?? null,
		reasons: picked.reasons,
		signs: picked.signs ?? null,
	});
	if (judge === null) {
		await offerJudge(project, journal, task);
	}
}

/**
 * Asks on the Creds page for the judge's key, logged in the conversation so
 * its Requested line opens it, unless it was asked for before: one the
 * person dismissed stays dismissed, and one still open needs no second line.
 */
async function offerJudge(
	project: Project,
	journal: Project["journal"],
	task: string | null,
): Promise<void> {
	const asked = (await project.creds.requests()).some(
		(each) => each.name === JUDGE_KEY,
	);
	if (asked) {
		return;
	}
	await journal.record(
		"creds request",
		task,
		() =>
			project.creds.request(JUDGE_KEY, {
				scope: "device",
				purpose: PURPOSE,
				instructions: INSTRUCTIONS,
				task,
			}),
		(request) => ({ name: JUDGE_KEY, asked: request !== null }),
	);
}
