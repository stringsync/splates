import {
	ArchiveIcon,
	CheckIcon,
	CopyIcon,
	type LucideIcon,
} from "lucide-react";
import { type JSX, type ReactNode, useContext } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import { ArchiveConversation } from "./archive-offer";
import { touchButton } from "./board";
import { copiedLabel, useCopy } from "./card";
import { CardBody, CardShell, type Tone } from "./card-shell";
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
 * do what it may not: what it asks, then a foot with a note on its left and,
 * at its right, a button that copies the command to run it in a terminal,
 * and the action's own button. Once it is done, from its button or
 * anywhere else, it offers to archive the conversation, whose work splates
 * now has.
 */
export function ActionCard({
	label,
	Icon,
	title,
	body,
	action,
	done,
	gone,
	note,
	tone = "info",
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
	/** What the foot says on its left while it is still to do. */
	note?: string;
	/** Its header's tint while still to do, `destructive` for what it takes away. */
	tone?: Tone;
	/** What it acts on, between its body and its foot. */
	children?: ReactNode;
}): JSX.Element {
	const { refusal, attempt } = useRefusal();
	const archive = useContext(ArchiveConversation);
	const run = (): void => void attempt(action.run(), action.failed);
	return (
		<CardShell
			label={label}
			Icon={Icon}
			title={title}
			tone={done ? "success" : tone}
		>
			{body !== "" && <CardBody text={body} />}
			{children}
			<div className="flex flex-wrap items-center justify-end gap-2 border-border/60 border-t px-4 py-2.5 @max-md:px-3">
				{gone === null && !done && note !== undefined && (
					<span className="mr-auto text-muted-foreground text-xs">{note}</span>
				)}
				{gone !== null ? (
					<span className="text-muted-foreground text-xs">{gone}</span>
				) : done ? (
					<>
						<span className="flex items-center gap-1 text-success text-xs">
							<CheckIcon className="size-3.5" strokeWidth={3} />
							{action.done}
						</span>
						{archive !== null && (
							<Button
								size="sm"
								variant="outline"
								onClick={archive}
								className={cn("gap-1.5", touchButton)}
							>
								<ArchiveIcon data-icon="inline-start" />
								Archive
							</Button>
						)}
					</>
				) : (
					<>
						<Command command={action.command} />
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

/**
 * The command to run it from a terminal instead, which copies: a button that
 * says so, since an icon alone read as something else.
 */
function Command({ command }: { command: string }): JSX.Element {
	const { copied, copy } = useCopy();
	const done = copied.state === "copied";
	return (
		<Button
			size="sm"
			variant="outline"
			aria-label={`copy ${command}`}
			title={copied.state === "failed" ? copied.error : command}
			onClick={() => copy(command)}
			className="gap-1.5"
		>
			{done ? <CheckIcon /> : <CopyIcon />}
			{done ? "Copied" : "Copy command"}
			<span aria-live="polite" className="sr-only">
				{copiedLabel(copied, "")}
			</span>
		</Button>
	);
}
