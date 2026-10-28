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
import { PendingSpinner, useShowPending } from "./pending";
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
 * The card for an agent's request to let one project reach further into
 * another, which only the person may grant. Render it for a proposal with a
 * `grant`: Allow grants the reach and tells the agent, Deny tells the agent
 * no, each with an optional note. Once answered it folds to an event line
 * that opens it again.
 */
export function GrantCard({
	proposal,
}: {
	proposal: PermissionProposal;
}): JSX.Element {
	const { reply, sent } = useCardReply();
	const { refusal, attempt } = useRefusal();
	// Which answer is on its way; the card says it done once the thread holds it.
	const [busy, setBusy] = useState<"allow" | "deny" | null>(null);
	const showBusy = useShowPending(busy !== null);
	const [opened, setOpened] = useState(false);
	const ask = proposal.grant as NonNullable<PermissionProposal["grant"]>;
	const kept = useKept(`grant:${ask.in}:${ask.from}:${ask.reach}`, sent);
	const [more, setMore] = useState(kept.read);
	const written = useRef(more);
	const panel = useRef<HTMLDivElement>(null);
	const turn = useCardDictationTurn(panel);
	const noteHead = "\n\n> **Anything else?**\n\n";
	const note = sent?.split(noteHead).slice(1).join(noteHead) ?? more;
	const granted = sent?.includes(GRANTED) === true;
	const denied = sent?.includes(GRANT_DENIED) === true;
	const send = reply?.send ?? null;
	const deny = (): void => {
		if (send === null) {
			return;
		}
		setBusy("deny");
		const text = written.current.trim();
		void attempt(
			send(
				text === "" ? GRANT_DENIED : `${GRANT_DENIED}${noteHead}${text}`,
			).catch((error: unknown) => {
				setBusy(null);
				throw error;
			}),
			"Not denied",
		);
	};
	const allow = (): void => {
		if (send === null) {
			return;
		}
		setBusy("allow");
		void attempt(
			grantReach(ask.in, ask.from, ask.reach)
				.then(() => send(GRANTED))
				.catch((error: unknown) => {
					setBusy(null);
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
							disabled={send === null || busy !== null}
							onClick={() => turn(deny)}
							className="gap-1.5"
						>
							{busy === "deny" && showBusy ? (
								<PendingSpinner shown />
							) : (
								<BanIcon data-icon="inline-start" />
							)}
							Deny
						</Button>
						<Button
							size="sm"
							disabled={send === null || busy !== null}
							onClick={() => turn(allow)}
							className="gap-1.5"
						>
							{busy === "allow" && showBusy ? (
								<PendingSpinner shown />
							) : (
								<CheckIcon data-icon="inline-start" />
							)}
							Allow
						</Button>
					</>
				)}
			</div>
			<Refusal refusal={refusal} />
		</CardShell>
	);
}
