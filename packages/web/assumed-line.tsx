import { makeAssistantDataUI, useAuiState } from "@assistant-ui/react";
import {
	type AssumedLine as Assumed,
	KIND_LABELS,
	overturnMessage,
	overturnsIn,
} from "@splates/server/trust/browser";
import { type JSX, useContext, useState } from "react";
import { ReplyContext, textOf } from "./card-reply";
import { type Act, SplatesEvent, type SplatesEventView } from "./splates-event";
import { overturnDecisions, TrustBadge, TrustContext } from "./trust-widget";

/** What a `data-assumed` part carries: one Assumed line and its number in the conversation. */
export interface AssumedData extends Assumed {
	/** Its place among the conversation's Assumed lines, from 1, as `[SPLATES OVERTURN <n>]` names it. */
	number: number;
}

/** Renders a `data-assumed` part as its hairline. */
export const AssumedUI = makeAssistantDataUI<AssumedData>({
	name: "assumed",
	render: ({ data }) => <AssumedLine {...data} />,
});

/**
 * A call the agent made without asking, at high trust, as a line of
 * splates's: the shield, `Assumed`, the pick, the alternative and its kind,
 * and Overturn, which tells the agent to switch to the alternative and counts
 * double against its trust. Once overturned, the line says so instead.
 */
export function AssumedLine({
	assumed,
	alternative,
	kind,
	number,
}: AssumedData): JSX.Element {
	const reply = useContext(ReplyContext);
	const [busy, setBusy] = useState(false);
	const overturned = useAuiState((state) =>
		state.thread.messages
			.slice(state.message.index + 1)
			.some(
				(next) =>
					next.role === "user" &&
					overturnsIn(textOf(next)).some((each) => each.number === number),
			),
	);
	const send = reply?.send ?? null;
	return (
		<SplatesEvent
			event={assumedEvent(
				{ assumed, alternative, kind },
				send === null && !overturned
					? null
					: {
							label: "Overturn",
							busy,
							done: overturned ? "Overturned" : null,
							run: () => {
								if (send === null) {
									return;
								}
								setBusy(true);
								void send(
									overturnMessage(number, assumed, alternative),
								).finally(() => setBusy(false));
							},
						},
			)}
		/>
	);
}

/** An Assumed line's event: the shield, `Assumed`, the pick, then the alternative and kind, and `act`. */
export function assumedEvent(
	{ assumed, alternative, kind }: Assumed,
	act: Act | null,
): SplatesEventView {
	return {
		mark: "assumed",
		words: ["Assumed", { kind: "pick", pick: assumed }],
		secondary: (
			<span className="min-w-0 whitespace-normal">
				(vs {alternative} · {KIND_LABELS[kind]})
			</span>
		),
		title: `Assumed without asking: ${assumed}, rather than ${alternative}`,
		act,
	};
}

/** An overturn's event: what the user switched the call to. */
export function overturnedEvent(
	words: string,
	at: string | null = null,
): SplatesEventView {
	return {
		mark: "failed",
		words: ["Overturned", { kind: "pick", pick: words }],
		at,
	};
}

/**
 * A message that only overturns an assumption, `[SPLATES OVERTURN 2]
 * Retry limit: 3 → 5`, as its line: what the user switched it to. Null for
 * any other message.
 */
export function overturnOf(
	text: string,
): { number: number; words: string } | null {
	const trimmed = text.trim();
	const [only, ...more] = overturnsIn(trimmed);
	if (only === undefined || more.length > 0 || !trimmed.startsWith("[")) {
		return null;
	}
	return {
		number: only.number,
		words: only.words === "" ? `#${only.number}` : only.words,
	};
}

/**
 * The line an overturn draws in place of the user's message, ending with
 * what it did to trust once its decision is read.
 */
export function OverturnedLine({
	number,
	words,
	at = null,
}: {
	/** Which assumption it overturned, as `[SPLATES OVERTURN <n>]` numbers it. */
	number: number;
	words: string;
	at?: string | null;
}): JSX.Element {
	const decisions = overturnDecisions(useContext(TrustContext), number, words);
	return (
		<SplatesEvent
			event={{
				...overturnedEvent(words, at),
				trust: decisions.length > 0 && <TrustBadge decisions={decisions} />,
			}}
		/>
	);
}
