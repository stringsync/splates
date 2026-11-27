import type { ConversationState } from "../conversations";
import { pickedModel } from "../models";
import {
	APPROVE,
	answerIn,
	approvalOf,
	besides,
	isEmpty,
	type Question,
	stretches,
	takenOf,
} from "../plans";
import { assumedLines, overturnsIn } from "./assumed";
import { classifyQuestion, hasImage } from "./classify";
import type { DecisionOutcome, TrustAssumption, TrustDecision } from "./types";

/**
 * Extracts every answered agent decision from a conversation's message history:
 * - question cards with a `(chosen)` pick (tagged as `mockup` + `visual` when
 *   an image is attached, otherwise `question` + classified kind)
 * - plan approval cards (`approval` kind, `plan` source)
 *
 * Each decision gets a deterministic `id` so re-observing the conversation as
 * later turns finish never double-counts earlier answers.
 */
export function extractConversationDecisions(
	state: ConversationState,
	project: string,
	at: string,
): TrustDecision[] {
	const model = pickedModel(state.settings);
	const messages = state.messages.filter((message) => !message.queued);
	const found: TrustDecision[] = [];

	for (let i = 0; i < messages.length; i += 1) {
		const message = messages[i];
		if (message?.role !== "agent") {
			continue;
		}
		const replyMessage = nextUserReply(messages, i + 1);
		if (replyMessage === null) {
			continue;
		}
		const answeredAt = replyMessage.at ?? at;
		const assistantText = textOf(message.parts);
		const replyText = textOf(replyMessage.parts).trim();
		if (replyText === "") {
			continue;
		}
		const parts = stretches(assistantText);
		for (let stretchIdx = 0; stretchIdx < parts.length; stretchIdx += 1) {
			const stretch = parts[stretchIdx];
			if (stretch?.type !== "questions") {
				continue;
			}
			const isPlan = parts[stretchIdx - 1]?.type === "plan";
			const approval = isPlan ? approvalOf(stretch.questions) : null;

			for (
				let questionIdx = 0;
				questionIdx < stretch.questions.length;
				questionIdx += 1
			) {
				const asked = stretch.questions[questionIdx] as Question;
				if (approval !== null && questionIdx === approval.at) {
					const outcome = planApprovalOutcome(
						asked,
						approval.yes,
						stretch.questions,
						replyText,
					);
					if (outcome !== null) {
						found.push({
							id: `conv:${state.id}:${i}:${stretchIdx}:${questionIdx}`,
							at: answeredAt,
							project,
							agent: state.agent,
							model,
							kind: "approval",
							source: "plan",
							outcome,
							subject: asked.text,
							conversation: state.id,
							task: state.task ?? state.lastTask,
						});
					}
					continue;
				}

				const judged = questionPickOutcome(asked, replyText);
				if (judged === null) {
					continue;
				}
				const { outcome, instead } = judged;
				const visual = hasImage(asked);
				const picked = choiceTexts(asked, takenOf(asked).picks);
				found.push({
					id: `conv:${state.id}:${i}:${stretchIdx}:${questionIdx}`,
					at: answeredAt,
					project,
					agent: state.agent,
					model,
					kind: classifyQuestion(asked),
					source: visual ? "mockup" : "question",
					outcome,
					subject: asked.text,
					...(picked === "" ? {} : { picked }),
					...(instead === "" ? {} : { instead }),
					conversation: state.id,
					task: state.task ?? state.lastTask,
				});
			}
		}
	}

	return found;
}

/**
 * Every `🛡 Assumed:` line the conversation's agent wrote, numbered from 1 in
 * order, and an overturned `unasked` decision for each one a later user
 * message overturned with `[SPLATES OVERTURN <n>]`. Ids are deterministic, so
 * observing the conversation again never counts one twice.
 */
export function extractAssumptions(
	state: ConversationState,
	project: string,
	at: string,
): { assumptions: TrustAssumption[]; overturns: TrustDecision[] } {
	const model = pickedModel(state.settings);
	const task = state.task ?? state.lastTask;
	const assumptions: TrustAssumption[] = [];
	const overturns: TrustDecision[] = [];
	for (const message of state.messages) {
		if (message.queued) {
			continue;
		}
		const text = textOf(message.parts);
		if (message.role === "agent") {
			for (const line of assumedLines(text)) {
				const number = assumptions.length + 1;
				assumptions.push({
					id: assumptionId(state.id, number),
					number,
					at: message.at ?? at,
					project,
					agent: state.agent,
					model,
					...line,
					conversation: state.id,
					task,
				});
			}
			continue;
		}
		for (const { number, words } of overturnsIn(text)) {
			const assumed = overturned(assumptions, number, words);
			if (assumed === null) {
				continue;
			}
			overturns.push(overturnOf(assumed, words, message.at ?? at));
		}
	}
	return { assumptions, overturns };
}

/**
 * The assumption `[SPLATES OVERTURN <number>] <words>` overturns: the
 * `number`-th, unless the words name another's pick before their `→`, as when
 * the page counted differently, then the latest with that pick.
 */
function overturned(
	assumptions: readonly TrustAssumption[],
	number: number,
	words: string,
): TrustAssumption | null {
	const named = words.includes("→") ? (words.split("→")[0] ?? "").trim() : "";
	const numbered = assumptions[number - 1];
	if (named === "" || numbered?.assumed === named) {
		return numbered ?? null;
	}
	return (
		assumptions.findLast((each) => each.assumed === named) ?? numbered ?? null
	);
}

/** The id of conversation `conversation`'s `number`-th assumption. */
export function assumptionId(conversation: string, number: number): string {
	return `assumed:${conversation}:${number}`;
}

/**
 * The overturned `unasked` decision for `assumed`, which weighs double an
 * asked pick's; `words` is what the user said instead, its alternative when
 * they said nothing more, or said only `<assumed> → <alternative>`.
 */
export function overturnOf(
	assumed: TrustAssumption,
	words: string,
	at: string,
): TrustDecision {
	const arrow = words.split("→");
	const instead =
		arrow.length > 1
			? (arrow.at(-1) ?? "").trim() || assumed.alternative
			: words || assumed.alternative;
	return {
		id: `overturn:${assumed.id}`,
		at,
		taskAt: assumed.at,
		project: assumed.project,
		agent: assumed.agent,
		model: assumed.model,
		kind: assumed.kind,
		source: "unasked",
		outcome: "overturned",
		subject: assumed.assumed,
		picked: assumed.assumed,
		instead,
		conversation: assumed.conversation,
		task: assumed.task,
	};
}

/** The texts of `asked`'s choices under `keys`, joined, or the empty string. */
function choiceTexts(asked: Question, keys: readonly string[]): string {
	return asked.choices
		.filter((choice) => keys.includes(choice.key))
		.map((choice) => choice.text.trim())
		.join("; ");
}

/**
 * Evaluates a user's reply against a question that offered a `(chosen)` pick,
 * with what the user answered instead when it was overturned (empty otherwise).
 * Returns null if the question offered no `(chosen)` pick or was not answered.
 */
function questionPickOutcome(
	asked: Question,
	replyText: string,
): { outcome: DecisionOutcome; instead: string } | null {
	const recommended = takenOf(asked).picks;
	if (recommended.length === 0) {
		return null;
	}
	const answer = answerIn(replyText, asked);
	if (answer === null || isEmpty(answer)) {
		return null;
	}
	const words = answer.words.trim();
	if (answer.picks.length === 0) {
		// Answered in words alone without taking the pick: overturned.
		return { outcome: "overturned", instead: words };
	}
	const samePicks =
		answer.picks.length === recommended.length &&
		answer.picks.every((key) => recommended.includes(key));
	if (!samePicks) {
		const instead = [choiceTexts(asked, answer.picks), words]
			.filter((each) => each !== "")
			.join(": ");
		return { outcome: "overturned", instead };
	}
	return { outcome: words === "" ? "kept" : "amended", instead: "" };
}

/**
 * Evaluates a user's reply to a plan's approval question (`Do you approve ...?`).
 * - Yes (or `[SPLATES APPROVE]` / `"approve"`) with no caveats or overturned
 *   companion questions -> `kept`
 * - Yes with extra words or an amended/overturned companion question -> `amended`
 * - No, or unanswered approval with a note sending it back -> `overturned`
 */
function planApprovalOutcome(
	asked: Question,
	yesKey: string,
	allQuestions: Question[],
	replyText: string,
): DecisionOutcome | null {
	const trimmed = replyText.trim();
	const extra = besides(trimmed, allQuestions);

	if (trimmed === APPROVE || /^approve[.!]?$/i.test(trimmed)) {
		return "kept";
	}

	const answer = answerIn(trimmed, asked);
	if (answer !== null && !isEmpty(answer)) {
		if (answer.picks.includes(yesKey)) {
			const hasWords = answer.words.trim() !== "" || extra !== "";
			return hasWords ? "amended" : "kept";
		}
		// Picked No or answered in words instead of Yes.
		return "overturned";
	}

	// Approval left unanswered while replying with words (e.g. "approve, but..." or sending back).
	if (extra !== "") {
		if (/^approve\b/i.test(extra)) {
			return "amended";
		}
		return "overturned";
	}

	return null;
}

/** The next user message at or after `from`, stopping if another assistant turn intervenes. */
function nextUserReply(
	messages: ConversationState["messages"],
	from: number,
): ConversationState["messages"][number] | null {
	for (let i = from; i < messages.length; i += 1) {
		const message = messages[i];
		if (message?.role === "user") {
			return message;
		}
		if (message?.role === "agent") {
			return null;
		}
	}
	return null;
}

function textOf(parts: ConversationState["messages"][number]["parts"]): string {
	return parts
		.flatMap((part) => (part.type === "text" ? [part.text] : []))
		.join("");
}

/** Matches `This reverts commit <sha>.` in a standard `git revert` commit body. */
const REVERTS_SHA = /This reverts commit ([0-9a-f]{7,40})\b/i;
/** Matches `Revert "<subject>"` in a standard `git revert` commit subject. */
const REVERT_SUBJECT = /^Revert "(.+)"$/;

/**
 * Parses a git commit's subject and body to extract the reverted commit SHA
 * and/or reverted subject line, or null if not a revert commit.
 */
export function parseRevertCommit(
	subject: string,
	body: string,
): { sha: string | null; revertedSubject: string | null } | null {
	const sha = REVERTS_SHA.exec(body)?.[1] ?? null;
	const revertedSubject = REVERT_SUBJECT.exec(subject.trim())?.[1] ?? null;
	if (sha === null && revertedSubject === null) {
		return null;
	}
	return { sha, revertedSubject };
}
