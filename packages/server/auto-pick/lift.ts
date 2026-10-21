import type { Conversations, Lift, Setting } from "../conversations";
import {
	type AgentPick,
	effortSettings,
	modelOption,
	thinkingOf,
} from "../models";
import type { Project } from "../server/shared";
import { classify } from "./classify";
import { decide, headline } from "./decide";
import { wordsToJudge } from "./follow-up";
import { judgeFrom } from "./judge";
import { autoPicked } from "./judged";
import { classificationKey } from "./key";
import { higher, pickOf } from "./rank";
import { contextOf, journalPick, setOf } from "./start";
import type { Judge } from "./system-one";

/**
 * Auto pick's second look at what the person says in a conversation it
 * started, unless they have moved its model or effort since: the judge reads
 * what they say, and when the rules give a stronger model, or a higher
 * thinking level on the same one, on the same agent, the conversation moves
 * up before the agent reads it, logged as splates's own line with an Undo. A
 * pick it judges lighter leaves it as it is.
 */
export function lifting(
	project: Project,
	conversations: Conversations,
	{
		judge = () => judgeFrom(project.creds.credentials),
		now = () => new Date(),
	}: {
		/** The judge to ask; the one the project's creds give by default. */
		judge?: () => Promise<Judge | null>;
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
		if (words === null) {
			return;
		}
		const classified = await classify({ ...words, judge: await judge() });
		if (!classified.ok) {
			return;
		}
		const context = await contextOf(project, conversations, now());
		const decision = decide({
			...context,
			classification: classified.classification,
		});
		const agent = context.agents.find((each) => each.id === on.agent);
		if (agent === undefined || !higher(context.agents, on, decision.pick)) {
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
		const key = classificationKey(words.subject, words.detail, []);
		await journalPick(
			project.journal.in(state.id),
			state.task,
			autoPicked(
				{
					decision,
					classification: classified.classification,
					judged: true,
				},
				key,
				now(),
			),
			{ from: headline(pickOf(on), agent), undo },
		).catch((error: unknown) => project.log.error(String(error)));
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
