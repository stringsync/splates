import type { PermissionProposal } from "@stringsync/splates-server/plans";
import {
	GRANT_DENIED,
	GRANTED,
} from "@stringsync/splates-server/plans/browser";
import type { Reach } from "@stringsync/splates-server/projects";
import { BanIcon, CheckIcon, KeyRoundIcon } from "lucide-react";
import { type JSX, useRef, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { CardBox, useCardDictationTurn } from "./card-box";
import { useCardReply, useKept } from "./card-reply";
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
 * taken back if either fails. Deny, with the 'Anything else?' box as the
 * run-command card has, sends `[SPLATES GRANT DENIED]` and grants nothing.
 * Once answered it folds to an event line,
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
	const [denying, setDenying] = useState(false);
	const [opened, setOpened] = useState(false);
	const ask = proposal.grant as NonNullable<PermissionProposal["grant"]>;
	const kept = useKept(`grant:${ask.in}:${ask.from}:${ask.reach}`, sent);
	const [more, setMore] = useState(kept.read);
	const written = useRef(more);
	const panel = useRef<HTMLDivElement>(null);
	const turn = useCardDictationTurn(panel);
	const marker = "\n\n> **Anything else?**\n\n";
	const note = sent?.split(marker).slice(1).join(marker) ?? more;
	const granted = chosen || sent?.includes(GRANTED) === true;
	const denied = denying || sent?.includes(GRANT_DENIED) === true;
	const send = reply?.send ?? null;
	const deny = (): void => {
		if (send === null) {
			return;
		}
		setDenying(true);
		const text = written.current.trim();
		void attempt(
			send(
				text === "" ? GRANT_DENIED : `${GRANT_DENIED}${marker}${text}`,
			).catch((error: unknown) => {
				setDenying(false);
				throw error;
			}),
			"Not denied",
		);
	};
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
	if ((granted || denied) && !opened) {
		return (
			<>
				<SplatesEvent
					event={{
						mark: granted ? "landed" : "failed",
						words: [
							`${granted ? "Granted" : "Denied"} ${ask.from} ${ask.reach} in ${ask.in}`,
						],
						title: granted ? GRANTED : GRANT_DENIED,
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
			{!granted && !denied && send !== null ? (
				<div ref={panel} className="flex flex-col gap-3 border-t px-4 py-4">
					<p className="font-medium text-sm leading-snug">Anything else?</p>
					<CardBox
						aria-label="Anything else"
						value={more}
						placeholder="Your answer (optional)"
						files={null}
						onValue={(text) => {
							written.current = text;
							setMore(text);
							kept.write(text);
						}}
					/>
				</div>
			) : (granted || denied) && note.trim() !== "" ? (
				<CardBody text={`> **Anything else?**\n\n${note}`} />
			) : null}
			<div className="flex flex-wrap items-center justify-end gap-2 border-border/60 border-t px-4 py-2.5 @max-md:px-3">
				{granted || denied ? (
					<span className="flex items-center gap-1 text-xs">
						{granted ? (
							<CheckIcon className="size-3.5 text-success" strokeWidth={3} />
						) : (
							<BanIcon className="size-3.5" />
						)}
						{granted ? "Granted" : "Denied"}
					</span>
				) : (
					<>
						<Button
							size="sm"
							variant="outline"
							disabled={send === null}
							onClick={() => turn(deny)}
							className="gap-1.5"
						>
							<BanIcon data-icon="inline-start" />
							Deny
						</Button>
						<Button
							size="sm"
							disabled={send === null}
							onClick={() => turn(allow)}
							className="gap-1.5"
						>
							<CheckIcon data-icon="inline-start" />
							Allow
						</Button>
					</>
				)}
			</div>
			<Refusal refusal={refusal} />
		</CardShell>
	);
}
