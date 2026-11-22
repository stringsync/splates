import type { ConversationState } from "@splates/server/conversations";
import type { Needing } from "@splates/server/plans";
import { type JSX, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { Checkbox } from "#web/components/ui/checkbox.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#web/components/ui/dialog.tsx";
import { cn } from "#web/lib/utils.ts";
import { archiveConversation } from "./conversation-api";
import { ItemIcon } from "./conversation-item";
import { unnamed, useNameOf } from "./conversation-names";
import { keyOfRow } from "./conversation-rows";
import { Mark } from "./mark";
import { useEnding } from "./queued-ending";
import { useRowStatus } from "./row-status";

/**
 * A dialog showing the finished conversations in `rows`, for you to archive
 * together. All are ticked; untick one to keep it. Archive files the ticked
 * ones away and closes `onClose`'s dialog, or says how many were refused.
 */
export function ArchiveFinished({
	rows,
	agentOf,
	open,
	onClose,
}: {
	rows: Needing[];
	/** The name of the agent a conversation ran on, for its icon. */
	agentOf: (conversation: ConversationState) => string;
	open: boolean;
	onClose: () => void;
}): JSX.Element {
	const [kept, setKept] = useState<ReadonlySet<string>>(new Set());
	const [busy, setBusy] = useState(false);
	const [failed, setFailed] = useState(0);
	const chosen = rows.filter((row) => !kept.has(keyOfRow(row)));
	const archive = async () => {
		setBusy(true);
		const results = await Promise.allSettled(
			chosen.flatMap(({ conversation }) =>
				conversation === null
					? []
					: [archiveConversation(conversation.id, true)],
			),
		);
		setBusy(false);
		const refused = results.filter((each) => each.status === "rejected").length;
		setFailed(refused);
		if (refused === 0) {
			onClose();
		}
	};
	const toggle = (key: string, on: boolean) =>
		setKept((was) => {
			const next = new Set(was);
			if (on) {
				next.delete(key);
			} else {
				next.add(key);
			}
			return next;
		});
	return (
		<Dialog open={open} onOpenChange={(next) => !next && onClose()}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Archive finished conversations</DialogTitle>
					<DialogDescription>
						Their tasks are merged or removed. Untick any to keep it in the
						list. Conversations that never ran a task stay.
					</DialogDescription>
				</DialogHeader>
				<ul className="-mx-1 flex max-h-72 flex-col gap-0.5 overflow-y-auto">
					{rows.map((row) => (
						<FinishedRow
							key={keyOfRow(row)}
							row={row}
							agent={row.conversation === null ? "" : agentOf(row.conversation)}
							ticked={!kept.has(keyOfRow(row))}
							onTick={(on) => toggle(keyOfRow(row), on)}
						/>
					))}
				</ul>
				{failed > 0 && (
					<p role="alert" className="text-destructive text-sm">
						{failed} not archived. Try again.
					</p>
				)}
				<DialogFooter>
					<Button variant="outline" onClick={onClose}>
						Cancel
					</Button>
					<Button disabled={busy || chosen.length === 0} onClick={archive}>
						Archive {chosen.length}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/** A finished conversation as its sidebar row looks, its icon, name, status and ending, with a checkbox. */
function FinishedRow({
	row,
	agent,
	ticked,
	onTick,
}: {
	row: Needing;
	agent: string;
	ticked: boolean;
	onTick: (on: boolean) => void;
}): JSX.Element | null {
	const { conversation, need } = row;
	const nameOf = useNameOf();
	const status = useRowStatus(row);
	const { reported } = useEnding(conversation);
	if (conversation === null) {
		return null;
	}
	const id = `finished-${conversation.id}`;
	return (
		<li>
			<label
				htmlFor={id}
				className="flex cursor-pointer items-center gap-3 rounded-md py-1.5 pr-3 pl-2 hover:bg-foreground/[0.05]"
			>
				<Checkbox
					id={id}
					aria-label={nameOf(conversation)}
					checked={ticked}
					onCheckedChange={onTick}
				/>
				<ItemIcon conversation={conversation} agent={agent} />
				<span className="flex min-w-0 flex-1 flex-col gap-0.5">
					<span
						className={cn(
							"truncate text-sm",
							unnamed(conversation) && "text-muted-foreground italic",
						)}
					>
						{nameOf(conversation)}
					</span>
					<span className="truncate text-[11px] text-muted-foreground leading-4">
						{status.label}
					</span>
				</span>
				<Mark need={need} reported={reported} unread={conversation.unread} />
			</label>
		</li>
	);
}
