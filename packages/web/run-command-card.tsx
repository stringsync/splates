import type { PermissionProposal } from "@stringsync/splates-server/plans";
import {
	isWholeSuite,
	RUN_ALLOWED,
	RUN_DENIED,
} from "@stringsync/splates-server/plans/browser";
import { BanIcon, CheckIcon, TerminalIcon } from "lucide-react";
import { createContext, type JSX, useContext, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { useCardReply } from "./card-reply";
import { CardBody, CardShell } from "./card-shell";
import { useNow } from "./hooks/use-now";
import { MachineStats, useLiveMachine } from "./machine";
import { Refusal, useRefusal } from "./refusal";
import { SplatesEvent } from "./splates-event";

/**
 * Lets the open conversation's agent run the whole test suite once, which
 * splates refuses it otherwise; null outside a conversation.
 */
export const SuiteGrant = createContext<(() => Promise<void>) | null>(null);

/**
 * The card an agent asks to run a heavy command with: the command, why, and
 * how loaded the machine is now, read each second while it waits. Allow and Deny answer the agent with a
 * directive; the choice shows at once and is taken back if the send fails.
 * Once answered it folds to an event line, "Allowed <command>" or "Denied
 * <command>", that opens the card; the answer is drawn here only, not again
 * as the directive's own line.
 * Allowing the whole test suite first grants the conversation its one run.
 */
export function RunCommandCard({
	proposal,
}: {
	proposal: PermissionProposal;
}): JSX.Element {
	const { reply, sent } = useCardReply();
	const { refusal, attempt } = useRefusal();
	const [chosen, setChosen] = useState<string | null>(null);
	const [opened, setOpened] = useState(false);
	const grant = useContext(SuiteGrant);
	const suite = isWholeSuite(proposal.command ?? "");
	const choice = sent?.includes(RUN_ALLOWED)
		? RUN_ALLOWED
		: sent?.includes(RUN_DENIED)
			? RUN_DENIED
			: chosen;
	const live = useLiveMachine(choice === null);
	const now = useNow(choice === null);
	const send = reply?.send ?? null;
	const answer = (directive: string, failed: string): void => {
		if (send === null) {
			return;
		}
		setChosen(directive);
		const granted =
			directive === RUN_ALLOWED && suite && grant !== null
				? grant()
				: Promise.resolve();
		void attempt(
			granted
				.then(() => send(directive))
				.catch((error: unknown) => {
					setChosen(null);
					throw error;
				}),
			failed,
		);
	};
	if (choice !== null && !opened) {
		return (
			<>
				<SplatesEvent
					event={{
						mark: choice === RUN_ALLOWED ? "landed" : "failed",
						words: [
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
			label="run command"
			Icon={TerminalIcon}
			title={proposal.title ?? "Run a command"}
			tone={choice === RUN_ALLOWED ? "success" : "warning"}
		>
			<pre className="mx-4 mt-3 mb-2 overflow-x-auto rounded bg-muted px-3 py-2 text-sm">
				<code>{proposal.command}</code>
			</pre>
			{proposal.body !== "" && <CardBody text={proposal.body} />}
			{choice === null && (
				<MachineStats
					reading={live?.reading ?? null}
					at={live?.at}
					now={now}
					className="mx-4 mb-3"
				/>
			)}
			<div className="flex flex-wrap items-center justify-end gap-2 border-border/60 border-t px-4 py-2.5 @max-md:px-3">
				{choice !== null ? (
					<span className="flex items-center gap-1 text-xs">
						{choice === RUN_ALLOWED ? (
							<CheckIcon className="size-3.5 text-success" strokeWidth={3} />
						) : (
							<BanIcon className="size-3.5" />
						)}
						{choice === RUN_ALLOWED ? "Allowed" : "Denied"}
					</span>
				) : (
					<>
						<Button
							size="sm"
							variant="outline"
							disabled={send === null}
							onClick={() => answer(RUN_DENIED, "Not denied")}
							className="gap-1.5"
						>
							<BanIcon data-icon="inline-start" />
							Deny
						</Button>
						<Button
							size="sm"
							disabled={send === null}
							onClick={() => answer(RUN_ALLOWED, "Not allowed")}
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
