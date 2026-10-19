import type {
	Answer,
	Ask,
	ConversationState,
	Field,
} from "@stringsync/splates-server/conversations";
import type {
	Answer as CardAnswer,
	Question as PlanQuestion,
} from "@stringsync/splates-server/plans";
import { type JSX, useEffect } from "react";
import { PermissionGrant } from "#web/components/assistant-ui/elements/permission-grant.tsx";
import { Button } from "#web/components/ui/button.tsx";
import { ReplyContext } from "./card-reply";
import { answerConversation } from "./conversation-api";
import type { Drafts } from "./drafts";
import { useExpect } from "./expecting";
import { QuestionCards } from "./question-cards";
import { Refusal } from "./refusal";
import { useRowRefusal } from "./row-refusal";

/** What the agent is waiting on, answered in place or skipped. */
export function AskPanel({
	drafts,
	conversation,
	agent,
	ask,
	keys = true,
}: {
	/** What was typed and not sent, by conversation. */
	drafts: Drafts;
	conversation: ConversationState;
	agent: string;
	ask: Ask;
	/**
	 * Whether 1, 2 and 3 answer it, as for the one ask of the conversation
	 * open; off where several show, so one key answers one.
	 */
	keys?: boolean;
}): JSX.Element {
	// Its own draft beside the composer's: what is typed into its boxes.
	const key = `${conversation.id}:${ask.id}`;
	// Kept by conversation, since the card is gone while the answer is on its
	// way and comes back refused.
	const { refusal, refuse } = useRowRefusal(conversation.id);
	const expect = useExpect();
	const send = (answer: Answer) =>
		expect(
			conversation.id,
			{ ask: null },
			answerConversation(conversation.id, ask.id, answer),
		).then(
			() => drafts.write(key, ""),
			(error: unknown) => refuse("Not answered", error),
		);
	return (
		<>
			{ask.type === "permission" ? (
				<Permission
					ask={ask}
					command={commandOf(conversation, ask.id)}
					agent={agent}
					where={conversation.task ?? "the main tree"}
					send={send}
					keys={keys}
				/>
			) : (
				<Question ask={ask} send={send} drafts={drafts} draft={key} />
			)}
			<Refusal refusal={refusal} className="-mt-2 px-2" />
		</>
	);
}

/** The command the tool call `id` runs, for one that runs one. */
function commandOf(conversation: ConversationState, id: string): string | null {
	for (const message of conversation.messages) {
		for (const part of message.parts) {
			if (part.type === "tool" && part.id === id) {
				return part.command;
			}
		}
	}
	return null;
}

/**
 * A permission, through assistant-ui's grant: Deny, This session, and Always
 * stand for ACP's reject, allow once, and allow always, and digits 1 to 3
 * pick them in that order.
 */
function Permission({
	ask,
	command,
	agent,
	where,
	send,
	keys,
}: {
	ask: Extract<Ask, { type: "permission" }>;
	command: string | null;
	agent: string;
	where: string;
	send: (answer: Answer) => Promise<unknown>;
	keys: boolean;
}): JSX.Element {
	const grant = (scope: "denied" | "session" | "always") => {
		const kinds = {
			denied: ["reject_once", "reject_always"],
			session: ["allow_once", "allow_always"],
			always: ["allow_always", "allow_once"],
		}[scope];
		const option = kinds
			.map((kind) => ask.options.find((each) => each.kind === kind))
			.find((each) => each !== undefined);
		if (option !== undefined) {
			void send({ type: "permission", option: option.id });
		}
	};
	useEffect(() => {
		if (!keys) {
			return;
		}
		const pick = (event: KeyboardEvent) => {
			const scope = (["denied", "session", "always"] as const)[
				Number(event.key) - 1
			];
			const typing =
				event.target instanceof HTMLElement &&
				event.target.closest("input, textarea, select, [contenteditable]") !==
					null;
			if (scope !== undefined && !typing) {
				event.preventDefault();
				grant(scope);
			}
		};
		addEventListener("keydown", pick);
		return () => removeEventListener("keydown", pick);
	});
	return (
		<PermissionGrant
			aria-label="permission"
			capability={ask.title}
			command={command}
			requester={agent}
			reach={[`in ${where}`]}
			scope="pending"
			onGrant={grant}
			className="max-w-none"
		/>
	);
}

/**
 * A question form, as the questions card an agent's own questions show in:
 * each field with choices is a question, the field beside it answered in
 * words, such as Claude's "Other", its words; any other field a question
 * answered in words alone.
 */
function Question({
	ask,
	send,
	drafts,
	draft,
}: {
	ask: Extract<Ask, { type: "question" }>;
	send: (answer: Answer) => Promise<unknown>;
	drafts: Drafts;
	/** Where what is written in it and not yet sent is kept. */
	draft: string;
}): JSX.Element {
	const asked = formQuestions(ask.fields);
	const answer = async (answers: (CardAnswer | null)[]) => {
		await send({
			type: "question",
			values: Object.fromEntries(
				asked.flatMap(({ field, words }, at) => {
					const { picks = [], words: said = "" } = answers[at] ?? {};
					const picked = field.choices?.find(
						(_, index) => letter(index) === picks[0],
					);
					return [
						[field.key, field.choices === null ? said : (picked?.value ?? "")],
						...(words === null ? [] : [[words.key, said]]),
					];
				}),
			),
		});
	};
	return (
		<form
			aria-label="question"
			className="flex flex-col gap-2"
			onSubmit={(event) => event.preventDefault()}
		>
			<p className="font-medium text-sm">{ask.message}</p>
			<ReplyContext.Provider value={{ send: null, drafts }}>
				<QuestionCards
					questions={asked.map(({ question }) => question)}
					draft={draft}
					answer={answer}
				/>
			</ReplyContext.Provider>
			<Button
				type="button"
				size="sm"
				variant="ghost"
				className="self-start"
				onClick={() => void send({ type: "dismiss" })}
			>
				Skip
			</Button>
		</form>
	);
}

/** A form field as a question of the card, with the field its words go to. */
interface FormQuestion {
	question: PlanQuestion;
	field: Field;
	/** The field answered in words beside one with choices; null for none. */
	words: Field | null;
}

/**
 * `fields` as the card's questions, numbered from 1: a field answered in
 * words that follows one with choices, its key led by that one's, is that
 * one's words, as Claude's "Other" is.
 */
export function formQuestions(fields: Field[]): FormQuestion[] {
	const found: FormQuestion[] = [];
	for (const field of fields) {
		const last = found.at(-1);
		if (
			field.choices === null &&
			last !== undefined &&
			last.field.choices !== null &&
			last.words === null &&
			field.key.startsWith(last.field.key)
		) {
			last.words = field;
			continue;
		}
		found.push({
			question: {
				number: String(found.length + 1),
				done: false,
				text: field.title,
				size: null,
				body: field.description ?? "",
				reply: null,
				followUps: [],
				choices: (field.choices ?? []).map((choice, index) => ({
					key: letter(index),
					text: choice.title,
					body: choice.description ?? "",
					why: "",
					chosen: false,
				})),
				pick: field.choices === null ? null : "one",
			},
			field,
			words: null,
		});
	}
	return found;
}

/** The letter the card gives the choice at `index`: a, b, c. */
function letter(index: number): string {
	return String.fromCharCode(97 + index);
}
