import type { PermissionProposal } from "@stringsync/splates-server/plans";
import { GRANTED } from "@stringsync/splates-server/plans/browser";
import type { Reach } from "@stringsync/splates-server/projects";
import { CheckIcon, KeyRoundIcon } from "lucide-react";
import { type JSX, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { useCardReply } from "./card-reply";
import { CardBody, CardShell } from "./card-shell";
import { grantReach } from "./project-api";
import { Refusal, useRefusal } from "./refusal";
import { SplatesEvent } from "./splates-event";

/** What each reach lets the project granted it do, in plain words. */
const REACH_WORDS: Record<Reach, string> = {
	read: "look at its tasks and lanes",
	queue: "add tasks to its untriaged lane",
	tasks: "run its queue and lanes",
};

/**
 * The card an agent asks one project to let another reach further into it
 * with, which splates refuses an agent. Allow grants it from the page, then
 * tells the agent `[SPLATES GRANTED]`; the choice shows at once and is
 * taken back if either fails. Once answered it folds to an event line,
 * "Granted <from> <reach> in <in>", that opens the card.
 */
export function GrantCard({
	proposal,
}: {
	proposal: PermissionProposal;
}): JSX.Element {
	const { reply, sent } = useCardReply();
	const { refusal, attempt } = useRefusal();
	const [chosen, setChosen] = useState(false);
	const [opened, setOpened] = useState(false);
	const ask = proposal.grant as NonNullable<PermissionProposal["grant"]>;
	const granted = chosen || sent?.includes(GRANTED) === true;
	const send = reply?.send ?? null;
	const allow = (): void => {
		if (send === null) {
			return;
		}
		setChosen(true);
		void attempt(
			grantReach(ask.in, ask.from, ask.reach)
				.then(() => send(GRANTED))
				.catch((error: unknown) => {
					setChosen(false);
					throw error;
				}),
			"Not granted",
		);
	};
	if (granted && !opened) {
		return (
			<>
				<SplatesEvent
					event={{
						mark: "landed",
						words: [`Granted ${ask.from} ${ask.reach} in ${ask.in}`],
						title: GRANTED,
						act: { label: "Open", run: () => setOpened(true) },
					}}
				/>
				<Refusal refusal={refusal} />
			</>
		);
	}
	return (
		<CardShell
			label="grant reach"
			Icon={KeyRoundIcon}
			title={proposal.title ?? `Grant ${ask.from} ${ask.reach} in ${ask.in}`}
			tone={granted ? "success" : "warning"}
		>
			<p className="mx-4 mt-3 mb-2 text-sm">
				<span className="font-medium">{ask.in}</span> would let{" "}
				<span className="font-medium">{ask.from}</span> {REACH_WORDS[ask.reach]}{" "}
				(<code>{ask.reach}</code>).
			</p>
			{proposal.body !== "" && <CardBody text={proposal.body} />}
			<div className="flex flex-wrap items-center justify-end gap-2 border-border/60 border-t px-4 py-2.5 @max-md:px-3">
				{granted ? (
					<span className="flex items-center gap-1 text-xs">
						<CheckIcon className="size-3.5 text-success" strokeWidth={3} />
						Granted
					</span>
				) : (
					<Button
						size="sm"
						disabled={send === null}
						onClick={allow}
						className="gap-1.5"
					>
						<CheckIcon data-icon="inline-start" />
						Allow
					</Button>
				)}
			</div>
			<Refusal refusal={refusal} />
		</CardShell>
	);
}
