import {
	ArchiveIcon,
	CheckIcon,
	CopyIcon,
	type LucideIcon,
} from "lucide-react";
import { type JSX, type ReactNode, useContext, useState } from "react";
import { ArchiveConversation } from "./archive-offer";
import { copiedLabel, useCopy } from "./card";
import { CardFooter, type CardFooterAction } from "./card-footer";
import { CardBody, CardShell, type Tone } from "./card-shell";
import { Spinner } from "./pending";
import { ReasonNotice } from "./queue-reason";
import { useRefusal } from "./refusal";

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
	/** The `splates` command that does the same from a terminal, offered as a copy button when given. */
	command?: string;
	/** Makes the write, shown at once; rejects as the write does. */
	run: () => Promise<void>;
	/** What its refusal says, such as `Not queued`. */
	failed: string;
}

/**
 * The frame of a card through which an agent asks the person to have splates
 * do what it may not: what it asks, then a foot with a note on its left and,
 * at its right, a button that copies the command to run it in a terminal
 * when the action has one, and the action's own button. Once it is done, from its button or
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
	settling = false,
	note,
	tone = "info",
	reason = null,
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
	/** Whether its write has landed but the board does not show it yet, so the button stays busy rather than flashing idle. */
	settling?: boolean;
	/** What the foot says on its left while it is still to do. */
	note?: string;
	/** Its header's tint while still to do, `destructive` for what it takes away. */
	tone?: Tone;
	/** Why the agent could not do it itself, shown as a notice above its body. */
	reason?: string | null;
	/** What it acts on, between its body and its foot. */
	children?: ReactNode;
}): JSX.Element {
	const { refusal, attempt } = useRefusal();
	const archive = useContext(ArchiveConversation);
	const { copied, copy } = useCopy();
	const [running, setRunning] = useState(false);
	const pending = running || settling;
	const run = async (): Promise<void> => {
		if (pending) {
			return;
		}
		setRunning(true);
		try {
			await attempt(action.run(), action.failed);
		} finally {
			setRunning(false);
		}
	};
	const hasAbove =
		body !== "" ||
		reason !== null ||
		(children !== undefined && children !== null && children !== false);
	const copiedDone = copied.state === "copied";
	const footerNote =
		gone !== null ? (
			gone
		) : done ? (
			<span className="flex items-center gap-1 text-success text-xs">
				<CheckIcon className="size-3.5" strokeWidth={3} />
				{action.done}
			</span>
		) : (
			note
		);
	const actions: CardFooterAction[] =
		gone !== null
			? []
			: done
				? archive !== null
					? [
							{
								label: "Archive",
								Icon: ArchiveIcon,
								tone: "outline",
								primary: true,
								onClick: archive,
							},
						]
					: []
				: [
						...(action.command !== undefined
							? [
									{
										label: copiedDone ? "Copied" : "Copy command",
										Icon: copiedDone ? CheckIcon : CopyIcon,
										ariaLabel: `copy ${action.command}`,
										title:
											copied.state === "failed" ? copied.error : action.command,
										onClick: () => copy(action.command as string),
									},
								]
							: []),
						{
							label: pending ? "Working…" : action.verb,
							Icon: pending ? (Spinner as LucideIcon) : action.VerbIcon,
							tone: tone === "destructive" ? "destructive" : "default",
							primary: true,
							disabled: pending,
							busy: pending,
							onClick: () => void run(),
						},
					];
	return (
		<CardShell
			label={label}
			Icon={Icon}
			title={title}
			tone={done ? "success" : tone}
		>
			{reason !== null && !done && (
				<ReasonNotice reason={reason} last={body === ""} />
			)}
			{body !== "" && <CardBody text={body} />}
			{children}
			{action.command !== undefined && (
				<span aria-live="polite" className="sr-only">
					{copiedLabel(copied, "")}
				</span>
			)}
			<CardFooter
				note={footerNote}
				sheetNote={gone !== null || done ? footerNote : undefined}
				actions={actions}
				refusal={refusal}
				className={!hasAbove ? "border-t-0" : undefined}
			/>
		</CardShell>
	);
}
