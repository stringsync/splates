import { FolderPlusIcon, XIcon } from "lucide-react";
import { type JSX, type ReactNode, useContext, useState } from "react";
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
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
} from "#web/components/ui/empty.tsx";
import { AddProject } from "./add-project";
import { NavigationContext } from "./navigation";
import { forgetUsed } from "./new-conversation-project";
import { forgetProject } from "./project-api";
import type { Folder } from "./project-folders";
import { projectUrl } from "./project-places";
import { Refusal, useRefusal } from "./refusal";

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

/** Removing a project forgets its registration, preserving its repository and history. */
export function RemoveProjectButton({
	folder,
}: {
	folder: Folder;
}): JSX.Element | null {
	const removal = useRemoveProject(folder);
	if (removal === null) {
		return null;
	}
	return (
		<>
			<button
				type="button"
				className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none hover:bg-muted hover:text-foreground active:bg-muted active:text-foreground focus-visible:opacity-100 focus-visible:ring-3 focus-visible:ring-ring/40 group-hover/head:opacity-100 pointer-coarse:opacity-100"
				aria-label={`Remove project ${folder.name}`}
				title={`Remove project ${folder.name}`}
				onClick={removal.ask}
			>
				<XIcon className="size-3.5" />
			</button>
			{removal.dialog}
		</>
	);
}

/**
 * What removes `folder`'s project, asking first: `ask` opens the dialog
 * that confirms it, to render as `dialog`. Null for a folder of no project.
 */
export function useRemoveProject(
	folder: Folder,
): { ask: () => void; dialog: ReactNode } | null {
	const [open, setOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const navigation = useContext(NavigationContext);
	const { refusal, refuse } = useRefusal();
	const slug = folder.project;
	if (slug === null) {
		return null;
	}
	const remove = async () => {
		if (busy) {
			return;
		}
		setBusy(true);
		try {
			const next = await forgetProject(slug);
			forgetUsed(slug);
			setOpen(false);
			if (folder.here) {
				const url = new URL(location.href);
				url.searchParams.delete("project");
				url.hash = "";
				navigation.show(next === null ? url.toString() : projectUrl(next));
			}
		} catch (error) {
			refuse("Project not removed", error);
		} finally {
			setBusy(false);
		}
	};
	return {
		ask: () => setOpen(true),
		dialog: (
			<Dialog
				open={open}
				onOpenChange={(next) => {
					if (!busy) {
						setOpen(next);
					}
				}}
			>
				<DialogContent showCloseButton={!busy}>
					<DialogHeader>
						<DialogTitle>Remove project {folder.name}?</DialogTitle>
						<DialogDescription>
							This removes the project from splates on all devices. Its files
							and conversation history are kept. Add it again to bring it back.
						</DialogDescription>
					</DialogHeader>
					<Refusal refusal={refusal} />
					<DialogFooter>
						<DialogClose render={<Button variant="outline" disabled={busy} />}>
							Cancel
						</DialogClose>
						<Button
							variant="destructive"
							disabled={busy}
							onClick={() => void remove()}
						>
							{busy ? "Removing…" : "Remove project"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		),
	};
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
