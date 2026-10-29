import type { PermissionProposal } from "@stringsync/splates-server/plans";
import {
	isWholeSuite,
	RETRIED,
	RUN_ALLOWED,
	RUN_DENIED,
	retryOf,
	shipOf,
} from "@stringsync/splates-server/plans/browser";
import {
	BanIcon,
	CheckIcon,
	RotateCcwIcon,
	ShipIcon,
	TerminalIcon,
} from "lucide-react";
import { createContext, type JSX, useContext, useRef, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { CardBox, useCardDictationTurn } from "./card-box";
import { useCardReply, useKept } from "./card-reply";
import { CardBody, CardShell } from "./card-shell";
import { useNow } from "./hooks/use-now";
import { MachineStats, useLiveMachine } from "./machine";
import { NavigationContext } from "./navigation";
import { PendingSpinner, useShowPending } from "./pending";
import { shipsUrl } from "./project-places";
import { Refusal, useRefusal } from "./refusal";
import { grantRetry, Untold } from "./retry-grant";
import { SplatesEvent } from "./splates-event";

/**
 * Lets the open conversation's agent run the whole test suite once, which
 * splates refuses it otherwise; null outside a conversation.
 */
export const SuiteGrant = createContext<(() => Promise<void>) | null>(null);

/**
 * Shows an agent's request to run a heavy command, with why and how loaded
 * the machine is, for the person to Allow or Deny. Allowing the whole test
 * suite grants the conversation its one run; Grant on `splates retry <task>`
 * runs the retry; Ship on `splates ship <project>` opens the Ships page with
 * that project picked, which starts nothing itself.
 */
export function RunCommandCard({
	proposal,
}: {
	proposal: PermissionProposal;
}): JSX.Element {
	const { reply, sent } = useCardReply();
	const { refusal, attempt } = useRefusal();
	// What the server holds the person did, which the thread has yet to show.
	const [chosen, setChosen] = useState<string | null>(null);
	// The answer on its way; the card says it done only once it lands.
	const [busy, setBusy] = useState<string | null>(null);
	const showBusy = useShowPending(busy !== null);
	const [opened, setOpened] = useState(false);
	const navigation = useContext(NavigationContext);
	const kept = useKept(
		`run-command:${proposal.command}:${proposal.title}`,
		sent,
	);
	const [more, setMore] = useState(kept.read);
	const written = useRef(more);
	const panel = useRef<HTMLDivElement>(null);
	const turn = useCardDictationTurn(panel);
	const note =
		sent
			?.split("\n\n> **Anything else?**\n\n")
			.slice(1)
			.join("\n\n> **Anything else?**\n\n") ?? more;
	const grant = useContext(SuiteGrant);
	const suite = isWholeSuite(proposal.command ?? "");
	const retry = retryOf(proposal.command ?? "");
	const ship = shipOf(proposal.command ?? "");
	const choice =
		sent?.includes(RUN_ALLOWED) || sent?.includes(RETRIED)
			? RUN_ALLOWED
			: sent?.includes(RUN_DENIED)
				? RUN_DENIED
				: chosen;
	const live = useLiveMachine(choice === null && retry === null);
	const now = useNow(choice === null && retry === null);
	const send = reply?.send ?? null;
	const answer = (directive: string, failed: string): void => {
		if (send === null) {
			return;
		}
		setBusy(directive);
		if (directive === RUN_ALLOWED && retry !== null) {
			void attempt(
				grantRetry(retry, send, written.current)
					.then(() => setChosen(directive))
					.catch((error: unknown) => {
						if (error instanceof Untold) {
							setChosen(directive);
						}
						throw error;
					})
					.finally(() => setBusy(null)),
				"Merge attempts",
			);
			return;
		}
		const granted =
			directive === RUN_ALLOWED && suite && grant !== null
				? grant()
				: Promise.resolve();
		void attempt(
			granted
				.then(() =>
					send(
						written.current.trim() === ""
							? directive
							: `${directive}\n\n> **Anything else?**\n\n${written.current.trim()}`,
					),
				)
				.then(() => setChosen(directive))
				.finally(() => setBusy(null)),
			failed,
		);
	};
	if (choice !== null && !opened) {
		return (
			<>
				<SplatesEvent
					event={{
						mark: choice === RUN_ALLOWED ? "landed" : "failed",
						words:
							retry !== null
								? [
										choice === RUN_ALLOWED
											? "Granted merge attempts to"
											: "Denied merge attempts to",
										{ kind: "task", task: retry },
									]
								: [
										choice === RUN_ALLOWED ? "Allowed" : "Denied",
										{ kind: "command", command: proposal.command ?? "" },
									],
						title: choice,
						act: { label: "Open", run: () => setOpened(true) },
					}}
				/>
				<Refusal refusal={refusal} />
			</>
		);
	}
	return (
		<CardShell
			label={
				retry !== null ? "retry merge" : ship !== null ? "ship" : "run command"
			}
			Icon={
				retry !== null ? RotateCcwIcon : ship !== null ? ShipIcon : TerminalIcon
			}
			title={proposal.title ?? "Run a command"}
			tone={choice === RUN_ALLOWED ? "success" : "warning"}
		>
			<pre className="mx-4 mt-3 mb-2 overflow-x-auto rounded bg-muted px-3 py-2 text-sm">
				<code>{proposal.command}</code>
			</pre>
			{proposal.body !== "" && <CardBody text={proposal.body} />}
			{choice === null && retry === null && (
				<MachineStats
					reading={live?.reading ?? null}
					at={live?.at}
					now={now}
					className="mx-4 mb-3"
				/>
			)}
			{choice === null && send !== null ? (
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
			) : choice !== null && note.trim() !== "" ? (
				<CardBody text={`> **Anything else?**\n\n${note}`} />
			) : null}
			<div className="flex flex-wrap items-center justify-end gap-2 border-border/60 border-t px-4 py-2.5">
				{choice !== null ? (
					<span className="flex items-center gap-1 text-xs">
						{choice === RUN_ALLOWED ? (
							<CheckIcon className="size-3.5 text-success" strokeWidth={3} />
						) : (
							<BanIcon className="size-3.5" />
						)}
						{choice === RUN_ALLOWED
							? retry !== null
								? "Granted"
								: "Allowed"
							: "Denied"}
					</span>
				) : (
					<>
						<Button
							size="sm"
							variant="outline"
							disabled={send === null || busy !== null}
							onClick={() => turn(() => answer(RUN_DENIED, "Not denied"))}
							className="gap-1.5"
						>
							{busy === RUN_DENIED && showBusy ? (
								<PendingSpinner shown />
							) : (
								<BanIcon data-icon="inline-start" />
							)}
							Deny
						</Button>
						<Button
							size="sm"
							disabled={send === null || busy !== null}
							onClick={() => {
								if (ship !== null) {
									navigation.show(shipsUrl(ship));
								} else {
									turn(() => answer(RUN_ALLOWED, "Not allowed"));
								}
							}}
							className="gap-1.5"
						>
							{busy === RUN_ALLOWED && showBusy ? (
								<PendingSpinner shown />
							) : retry !== null ? (
								<RotateCcwIcon data-icon="inline-start" />
							) : ship !== null ? (
								<ShipIcon data-icon="inline-start" />
							) : (
								<CheckIcon data-icon="inline-start" />
							)}
							{retry !== null
								? "Grant attempts"
								: ship !== null
									? "Open Ships"
									: "Allow"}
						</Button>
					</>
				)}
			</div>
			<Refusal refusal={refusal} />
		</CardShell>
	);
}
