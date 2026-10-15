import { useDroppable } from "@dnd-kit/core";
import { PlusIcon, XIcon } from "lucide-react";
import { type FormEvent, type JSX, useState } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { TodoState } from "../todo";
import { addLane } from "./api";
import { columnId } from "./lanes";
import { Refusal, useRefusal } from "./refusal";

/**
 * The last column, Trello's "Add another list": a name starts an empty lane.
 * While a card is in hand it is where to drop it to start a lane of its
 * own, and a card dropped there waits in it for the lane's name.
 */
export function AddLane({
	dragging,
	naming,
	onName,
	onUnname,
}: {
	dragging: boolean;
	/** The card dropped here, waiting for its lane's name. */
	naming?: TodoState;
	/** Starts the lane `naming` waits for. */
	onName: (name: string) => Promise<void>;
	/** Puts `naming` back where it was. */
	onUnname: () => void;
}): JSX.Element {
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const { setNodeRef, isOver } = useDroppable({ id: columnId("new") });
	const { refusal, attempt } = useRefusal();
	const close = () => {
		setOpen(false);
		setName("");
		if (naming) {
			onUnname();
		}
	};
	const save = (event: FormEvent) => {
		event.preventDefault();
		if (name.trim() === "") {
			return;
		}
		const write = naming ? onName(name) : addLane(name);
		void attempt(write, "Lane not added").then((added) => {
			if (added) {
				setName("");
				if (naming) {
					setOpen(false);
				}
			}
		});
	};
	return (
		<section
			ref={setNodeRef}
			aria-label="new lane"
			className={cn(
				"w-72 shrink-0 snap-start rounded-xl transition-colors",
				dragging
					? "border-2 border-dashed p-3"
					: (open || naming) && "bg-muted/70 p-2 dark:bg-muted/30",
				isOver && "bg-primary/10 ring-2 ring-primary/40",
			)}
		>
			{dragging ? (
				<p className="flex items-center gap-1.5 text-muted-foreground text-sm">
					<PlusIcon aria-hidden className="size-4" />
					Drop here to start a lane
				</p>
			) : open || naming ? (
				<form onSubmit={save} className="flex flex-col gap-2">
					{naming && (
						<p className="truncate px-1 text-muted-foreground text-xs">
							A lane for #{naming.id} {naming.subject}
						</p>
					)}
					<input
						// biome-ignore lint/a11y/noAutofocus: it opens because "Add another lane" was just pressed, or a card dropped here, to type its name
						autoFocus
						aria-label="new lane name"
						placeholder="Enter lane name"
						value={name}
						onChange={(event) => setName(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Escape") {
								close();
							}
						}}
						className="h-8 pointer-coarse:h-10 rounded-md border bg-background px-2 text-sm pointer-coarse:text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
					<Refusal refusal={refusal} />
					<div className="flex items-center gap-1">
						<Button
							type="submit"
							size="sm"
							disabled={name.trim() === ""}
							className="pointer-coarse:h-10 pointer-coarse:px-3"
						>
							Add lane
						</Button>
						<Button
							type="button"
							size="icon-sm"
							variant="ghost"
							aria-label="stop adding a lane"
							onClick={close}
							className="pointer-coarse:size-10"
						>
							<XIcon />
						</Button>
					</div>
				</form>
			) : (
				<button
					type="button"
					onClick={() => setOpen(true)}
					className="flex w-full pointer-coarse:min-h-10 cursor-pointer items-center gap-1.5 rounded-xl px-3 py-2.5 text-left text-muted-foreground text-sm outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
				>
					<PlusIcon aria-hidden className="size-4" />
					Add another lane
				</button>
			)}
		</section>
	);
}
