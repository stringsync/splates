import type { PermissionProposal } from "@splates/server/plans";
import {
	AUTO_ALLOWED,
	RETRIED,
	RUN_ALLOWED,
	RUN_DENIED,
	recOf,
	retryOf,
} from "@splates/server/plans/browser";
import { BanIcon, CheckIcon, RotateCcwIcon, TerminalIcon } from "lucide-react";
import { type JSX, useRef, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { CardBox, useCardDictationTurn } from "./card-box";
import { useCardReply, useKept } from "./card-reply";
import { CardSection } from "./card-section";
import { CardBody, CardShell } from "./card-shell";
import { useEnterDoes } from "./enter-while-taking";
import { useNow } from "./hooks/use-now";
import { MachineStats, useLiveMachine } from "./machine";
import { PendingSpinner, useShowPending } from "./pending";
import { Refusal, useRefusal } from "./refusal";
import { grantRetry, Untold } from "./retry-grant";
import { SplatesEvent } from "./splates-event";

/**
 * Shows an agent's request to run a heavy command, with why and how loaded
 * the machine is, for the person to Allow or Deny. Grant on
 * `splates retry <task>` runs the retry.
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
	const retry = retryOf(proposal.command ?? "");
	const rec = recOf(proposal.command ?? "");
	const choice =
		sent?.includes(RUN_ALLOWED) || sent?.includes(RETRIED)
			? RUN_ALLOWED
			: sent?.includes(RUN_DENIED)
				? RUN_DENIED
				: chosen;
	const auto = choice === RUN_ALLOWED && sent?.includes(AUTO_ALLOWED) === true;
	const live = useLiveMachine(choice === null && retry === null && !rec);
	const now = useNow(choice === null && retry === null);
	const send = reply?.send ?? null;
	const enterDoes = useEnterDoes(
		panel,
		send === null || busy !== null
			? null
			: () => turn(() => answer(RUN_ALLOWED, "Not allowed")),
	);
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
		void attempt(
			send(
				written.current.trim() === ""
					? directive
					: `${directive}\n\n> **Anything else?**\n\n${written.current.trim()}`,
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
										choice === RUN_ALLOWED
											? auto
												? "Auto-allowed, machine no longer busy:"
												: "Allowed"
											: "Denied",
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
			label={retry !== null ? "retry merge" : "run command"}
			Icon={retry !== null ? RotateCcwIcon : TerminalIcon}
			title={proposal.title ?? "Run a command"}
			tone={choice === RUN_ALLOWED ? "success" : "warning"}
		>
			<pre className="mx-4 mt-3 mb-2 whitespace-pre-wrap break-words rounded bg-muted px-3 py-2 text-sm">
				<code>{proposal.command}</code>
			</pre>
			{proposal.body !== "" && <CardBody text={proposal.body} />}
			{choice === null && retry === null && !rec && (
				<MachineStats
					reading={live?.reading ?? null}
					at={live?.at}
					now={now}
					className="mx-4 mb-3"
				/>
			)}
			{choice === null && send !== null ? (
				<div ref={panel} className="border-t px-4 py-4">
					<CardSection
						label="Anything else section"
						title="Anything else?"
						ruled={false}
					>
						<CardBox
							aria-label="Anything else"
							value={more}
							placeholder="Your answer (optional)"
							files={null}
							onKeyDown={enterDoes}
							onValue={(text) => {
								written.current = text;
								setMore(text);
								kept.write(text);
							}}
						/>
					</CardSection>
				</div>
			) : choice !== null && note.trim() !== "" ? (
				<CardBody text={`> **Anything else?**\n\n${note}`} />
			) : null}
			<div className="flex flex-wrap items-center justify-end gap-2 border-border/60 border-t px-4 py-2.5 @max-md:[&>a]:h-11 @max-md:[&>a]:flex-1 @max-md:[&>span.mr-auto]:basis-full">
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
								: auto
									? "Auto-allowed: the machine was no longer busy"
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
							className="gap-1.5 in-data-sheet:h-11 in-data-sheet:text-base"
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
							onClick={() => turn(() => answer(RUN_ALLOWED, "Not allowed"))}
							className="gap-1.5 in-data-sheet:h-11 in-data-sheet:flex-1 in-data-sheet:text-base"
						>
							{busy === RUN_ALLOWED && showBusy ? (
								<PendingSpinner shown />
							) : retry !== null ? (
								<RotateCcwIcon data-icon="inline-start" />
							) : (
								<CheckIcon data-icon="inline-start" />
							)}
							{retry !== null ? "Grant attempts" : "Allow"}
						</Button>
					</>
				)}
			</div>
			<Refusal refusal={refusal} />
		</CardShell>
	);
}
