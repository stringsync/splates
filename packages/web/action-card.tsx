import {
	ArchiveIcon,
	CheckIcon,
	ClockIcon,
	CopyIcon,
	type LucideIcon,
} from "lucide-react";
import { type JSX, type ReactNode, useContext, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { ArchiveConversation } from "./archive-offer";
import { copiedLabel, useCopy } from "./card";
import { CardBody, CardShell } from "./card-shell";
import { Refusal, useRefusal } from "./refusal";

/**
 * What a card asks splates to do for an agent, which splates refuses agents:
 * the command a person runs for it in a terminal, and the page's button that
 * makes the same write.
 */
export interface Action {
	/** The button that does it, such as `Queue now`. */
	verb: string;
	VerbIcon: LucideIcon;
	/** What the card says once it is done, such as `Queued`. */
	done: string;
	/** The `splates` command that does the same from a terminal. */
	command: string;
	/** Makes the write, shown at once; rejects as the write does. */
	run: () => Promise<void>;
	/** What its refusal says, such as `Not queued`. */
	failed: string;
}

/**
 * The frame of a card through which an agent asks the person to have splates
 * do what it may not: what it asks, the command to run it in a terminal, and
 * Later and the action's own button at the foot's right. Once its button has
 * done it, it offers to archive the conversation, whose work splates now has.
 */
export function ActionCard({
	label,
	Icon,
	title,
	body,
	action,
	done,
	gone,
	children,
}: {
	label: string;
	Icon: LucideIcon;
	title: string;
	body: string;
	action: Action;
	/** Whether the board already has it done, from this card or anywhere. */
	done: boolean;
	/** Why there is nothing left to do, such as the work no longer on the board. */
	gone: string | null;
	/** What it acts on, between its body and its command. */
	children?: ReactNode;
}): JSX.Element {
	const { refusal, attempt } = useRefusal();
	// Purely this page's: Later changes nothing anywhere.
	const [later, setLater] = useState(false);
	// Whether this card's button did it, shown at once, so it offers to
	// archive the conversation; not when it was done some other way.
	const [doneHere, setDoneHere] = useState(false);
	const archive = useContext(ArchiveConversation);
	const run = (): void => {
		setDoneHere(true);
		void attempt(action.run(), action.failed).then(
			(landed) => landed || setDoneHere(false),
		);
	};
	return (
		<CardShell
			label={label}
			Icon={Icon}
			title={title}
			tone={done ? "success" : "info"}
		>
			{body !== "" && <CardBody text={body} />}
			{children}
			{gone === null && !done && <Command command={action.command} />}
			<div className="flex flex-wrap items-center justify-end gap-2 border-border/60 border-t px-4 py-2.5 @max-md:px-3">
				{gone !== null ? (
					<span className="text-muted-foreground text-xs">{gone}</span>
				) : done ? (
					<>
						<span className="flex items-center gap-1 text-success text-xs">
							<CheckIcon className="size-3.5" strokeWidth={3} />
							{action.done}
						</span>
						{doneHere && archive !== null && (
							<Button
								size="sm"
								variant="outline"
								onClick={archive}
								className="gap-1.5"
							>
								<ArchiveIcon data-icon="inline-start" />
								Archive
							</Button>
						)}
					</>
				) : (
					<>
						{later ? (
							<span className="text-muted-foreground text-xs">
								Left for you to do when you choose
							</span>
						) : (
							<Button
								size="sm"
								variant="outline"
								onClick={() => setLater(true)}
								className="gap-1.5"
							>
								<ClockIcon data-icon="inline-start" />
								Later
							</Button>
						)}
						<Button size="sm" onClick={run} className="gap-1.5">
							<action.VerbIcon data-icon="inline-start" />
							{action.verb}
						</Button>
					</>
				)}
			</div>
			<Refusal refusal={refusal} />
		</CardShell>
	);
}

/** The command to run it from a terminal instead, which copies. */
function Command({ command }: { command: string }): JSX.Element {
	const { copied, copy } = useCopy();
	return (
		<div className="flex items-center gap-2 border-border/60 border-t px-4 py-2 @max-md:px-3">
			<code className="min-w-0 flex-1 truncate font-mono text-muted-foreground text-xs">
				{command}
			</code>
			<Button
				size="sm"
				variant="ghost"
				aria-label={`copy ${command}`}
				title={copied.state === "failed" ? copied.error : undefined}
				onClick={() => copy(command)}
				className="h-7 gap-1.5 text-xs"
			>
				<CopyIcon data-icon="inline-start" />
				<span aria-live="polite">{copiedLabel(copied, "Copy")}</span>
			</Button>
		</div>
	);
}
