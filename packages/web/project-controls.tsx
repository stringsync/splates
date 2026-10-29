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
 * An empty folder in the phone inbox, leaving its header and New action
 * available. It stands as tall as one conversation row, so archiving the last
 * one does not shift what lies below.
 */
export function ProjectEmpty(): JSX.Element {
	return (
		<Empty className="min-h-16 justify-center p-0 px-4">
			<EmptyHeader>
				<EmptyDescription>No conversations yet.</EmptyDescription>
			</EmptyHeader>
		</Empty>
	);
}
