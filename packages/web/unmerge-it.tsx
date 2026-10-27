import { unmergeReference } from "@stringsync/splates-server/plans/browser";
import { Undo2Icon } from "lucide-react";
import { type JSX, useContext, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#web/components/ui/dialog.tsx";
import { Textarea } from "#web/components/ui/textarea.tsx";
import { cn } from "#web/lib/utils.ts";
import { ReplyContext } from "./card-reply";

/**
 * Unmerge, on a merged card: takes `task` back off its base once the person
 * confirms, with anything else they wrote, or nothing to an external agent.
 */
export function UnmergeIt({
	task,
	className,
}: {
	task: string;
	className?: string;
}): JSX.Element | null {
	const reply = useContext(ReplyContext);
	const [asking, setAsking] = useState(false);
	const draft = `unmerge ${task}`;
	const [note, setNote] = useState(() => reply?.drafts.read(draft) ?? "");
	const send = reply?.send ?? null;
	// The conversation's own agent, who did the work, checks the merge can be
	// undone before it reverts anything.
	if (reply === null || send === null) {
		return null;
	}
	const write = (text: string) => {
		setNote(text);
		reply.drafts.write(draft, text);
	};
	return (
		<>
			<Button
				size="sm"
				variant="ghost"
				onClick={() => setAsking(true)}
				className={cn("gap-1.5 text-muted-foreground", className)}
			>
				<Undo2Icon data-icon="inline-start" />
				Unmerge
			</Button>
			<Dialog open={asking} onOpenChange={setAsking}>
				<DialogContent showCloseButton={false}>
					<DialogHeader>
						<DialogTitle>
							Unmerge <span className="font-mono">{task}</span>?
						</DialogTitle>
						<DialogDescription>
							The agent checks first that the merge can be undone: that nothing
							landed since builds on it, and that it was not shipped or did
							nothing outside the code. It reverts it only then, and asks you
							otherwise.
						</DialogDescription>
					</DialogHeader>
					<Textarea
						aria-label="Anything else"
						placeholder="Anything else, such as why, or what to keep"
						value={note}
						onChange={(change) => write(change.target.value)}
					/>
					<DialogFooter>
						<DialogClose render={<Button variant="outline" />}>
							Cancel
						</DialogClose>
						<Button
							variant="destructive"
							onClick={() => {
								setAsking(false);
								write("");
								void send(unmergeReference(task, note));
							}}
						>
							Unmerge
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
