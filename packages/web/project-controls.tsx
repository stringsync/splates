import { FolderPlusIcon } from "lucide-react";
import { type JSX, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
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

/** Adds a registered project from either conversation list. */
export function AddProjectButton(): JSX.Element {
	const [open, setOpen] = useState(false);
	return (
		<>
			<Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
				<FolderPlusIcon data-icon="inline-start" />
				Add a project
			</Button>
			<AddProjectDialog open={open} onOpenChange={setOpen} />
		</>
	);
}

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

/** A compact empty folder, leaving its header and New action available. */
export function ProjectEmpty(): JSX.Element {
	return (
		<Empty className="px-3 py-3">
			<EmptyHeader>
				<EmptyDescription>No conversations yet.</EmptyDescription>
			</EmptyHeader>
		</Empty>
	);
}
