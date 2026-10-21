import type { Conversations, Lift, Setting } from "../conversations";
import {
	type AgentPick,
	effortSettings,
	modelOption,
	thinkingOf,
} from "../models";
import type { Project } from "../server/shared";
import { type Classification, classify } from "./classify";
import {
	type AutoPickDecision,
	type DecideContext,
	decide,
	decideDeeper,
	headline,
} from "./decide";
import { askedBack, wordsToJudge } from "./follow-up";
import type { Attribution } from "./jev";
import { type JudgeFor, projectJudge } from "./judge";
import { autoPicked } from "./judged";
import { classificationKey } from "./key";
import { higher, pickOf } from "./rank";
import { contextOf, journalPick, setOf } from "./start";

/**
 * Auto pick's second look at what the person says in a conversation it
 * started, unless they have moved its model or effort since: the judge reads
 * what they say, and when the rules give a stronger model, or a higher
 * thinking level on the same one, on the same agent, the conversation moves
 * up before the agent reads it, logged as splates's own line with an Undo. So
 * does an answer to the agent's first reply that ended on a bare question,
 * to the rules' pick for the work one depth deeper. A pick it judges lighter
 * leaves it as it is.
 */
export function lifting(
	project: Project,
	conversations: Conversations,
	{
		slug = async () => null,
		judge = (who) => projectJudge(project, slug, who),
		now = () => new Date(),
	}: {
		/** The judge to ask; the one the project's creds give by default. */
		judge?: JudgeFor;
		/** The project's slug, to name it in the spend ledger; none when not given. */
		slug?: () => Promise<string | null>;
		now?: () => Date;
	} = {},
): Lift {
	return async (conversation, said) => {
		const { state } = conversation;
		const on = state.autoPick;
		if (on === null || on.overridden || on.agent !== state.agent) {
			return;
		}
		const words = wordsToJudge(state.messages, said);
		const asked = askedBack(state.messages, said);
		if (words === null && !asked) {
			return;
		}
		const context = await contextOf(project, conversations, now());
		const judged = await rejudged(words, context, judge, {
			task: state.task,
			conversation: state.id,
		});
		const decision =
			judged !== null && higher(context.agents, on, judged.decision.pick)
				? judged.decision
				: asked
					? decideDeeper(context, on, ASKED_BACK)
					: null;
		const agent = context.agents.find((each) => each.id === on.agent);
		if (
			decision === null ||
			agent === undefined ||
			!higher(context.agents, on, decision.pick)
		) {
			return;
		}
		const settings = settingsFor(state.settings, decision.pick);
		if (Object.keys(settings).length === 0) {
			return;
		}
		const undo = Object.fromEntries(
			Object.keys(settings).flatMap((id) => {
				const current = state.settings.find((each) => each.id === id)?.current;
				return current === undefined ? [] : [[id, current]];
			}),
		);
		await conversation.lift(settings, setOf(decision));
		await journalPick(
			project.journal.in(state.id),
			state.task,
			autoPicked(
				{
					decision,
					classification:
						decision === judged?.decision ? judged.classification : null,
					judged: true,
				},
				judged?.key ?? "",
				now(),
			),
			{ from: headline(pickOf(on), agent), undo },
		).catch((error: unknown) => project.log.error(String(error)));
	};
}

/** Why a first answer ending on a bare question moves the conversation up. */
const ASKED_BACK = "its first answer asked back";

/**
 * What the rules give for `words`, as the judge reads them, with the key
 * they are kept under; null for no words, or a judge that said nothing.
 */
async function rejudged(
	words: { subject: string; detail: string } | null,
	context: DecideContext,
	judge: JudgeFor,
	who: Partial<Attribution>,
): Promise<{
	decision: AutoPickDecision;
	classification: Classification;
	key: string;
} | null> {
	if (words === null) {
		return null;
	}
	const classified = await classify({ ...words, judge: await judge(who) });
	if (!classified.ok) {
		return null;
	}
	return {
		decision: decide({
			...context,
			classification: classified.classification,
		}),
		classification: classified.classification,
		key: classificationKey(words.subject, words.detail, []),
	};
}

/**
 * The settings, by id, that put a session offering `settings` on `pick`:
 * those it is not on already, and offers.
 */
function settingsFor(
	settings: Setting[],
	pick: AgentPick,
): Record<string, string> {
	const model =
		pick.model === undefined ? null : modelOption(settings, pick.model);
	const effort = effortSettings(pick.effort, settings);
	const levels = thinkingOf(settings).map((each) => each.value);
	const wanted: Record<string, string> = {
		...(model === null ? {} : { [model.setting]: model.value }),
		...Object.fromEntries(
			Object.entries(effort).filter(([, value]) => levels.includes(value)),
		),
	};
	return Object.fromEntries(
		Object.entries(wanted).filter(
			([id, value]) =>
				settings.find((each) => each.id === id)?.current !== value,
		),
	);
}
