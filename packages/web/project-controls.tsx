import type { JSX } from "react";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "#web/components/ui/dialog.tsx";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
} from "#web/components/ui/empty.tsx";
import { cn } from "#web/lib/utils.ts";
import { AddProject } from "./add-project";

/** The dialog that adds a registered project, wherever it is opened from. */
export function AddProjectDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}): JSX.Element {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Add a project</DialogTitle>
				</DialogHeader>
				<AddProject autoFocus />
			</DialogContent>
		</Dialog>
	);
}

/**
 * A compact empty folder, leaving its header and New action available. It
 * stands as tall as one conversation row (the phone inbox's are taller), so
 * archiving the last one does not shift what lies below.
 */
export function ProjectEmpty({
	phone = false,
}: {
	phone?: boolean;
}): JSX.Element {
	return (
		<Empty
			className={cn(
				"justify-center p-0",
				phone ? "min-h-16 px-4" : "min-h-8 pointer-coarse:min-h-10 px-3",
			)}
		>
			<EmptyHeader>
				<EmptyDescription>No conversations yet.</EmptyDescription>
			</EmptyHeader>
		</Empty>
	);
}
