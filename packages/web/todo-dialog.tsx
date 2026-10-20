import type { TaskRecord } from "@stringsync/splates-server/board";
import { type JSX, useRef } from "react";
import { Dialog, DialogContent } from "#web/components/ui/dialog.tsx";
import { cn } from "#web/lib/utils.ts";
import { PHONE_SHEET, TASK_DIALOG } from "./task-sections";
import { Edit } from "./todo-edit";

/**
 * `todo` open in its dialog, to change it, link it or drop it, from the board
 * or from wherever it is mentioned; closed while there is none.
 */
export function TodoDialog({
	todo,
	onClose,
}: {
	todo: TaskRecord | undefined;
	onClose: () => void;
}): JSX.Element {
	const popup = useRef<HTMLDivElement>(null);
	return (
		<Dialog
			open={todo !== undefined}
			onOpenChange={(open) => {
				if (!open) {
					onClose();
				}
			}}
		>
			{todo && (
				// Held here rather than in Edit, so opening another todo from a
				// mention swaps what the dialog shows without opening it again.
				<DialogContent
					ref={popup}
					// The dialog itself, not its subject: a phone keeps its
					// keyboard down until a field is tapped. Its close button takes
					// a finger on a touch screen.
					initialFocus={popup}
					className={cn(
						TASK_DIALOG,
						PHONE_SHEET,
						"pointer-coarse:[&>[data-slot=dialog-close]]:top-1 pointer-coarse:[&>[data-slot=dialog-close]]:right-1 pointer-coarse:[&>[data-slot=dialog-close]]:size-10",
					)}
				>
					{/* Keyed, so another todo starts on its own words. */}
					<Edit key={todo.id} todo={todo} onDone={onClose} />
				</DialogContent>
			)}
		</Dialog>
	);
}
