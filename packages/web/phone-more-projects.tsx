import { ChevronRightIcon, PlusIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#web/components/ui/collapsible.tsx";
import { type Folder, folderKey } from "./project-folders";

/**
 * The projects with no agent listed, folded into one section after the
 * folders, each a row that starts a conversation in it. Nothing while every
 * project has a folder.
 */
export function MoreSection({
	idle,
	open,
	onFold,
	onNew,
}: {
	idle: Folder[];
	open: boolean;
	onFold: (open: boolean) => void;
	/** Null while no conversation can start. */
	onNew: ((folder: Folder) => void) | null;
}): ReactNode {
	if (idle.length === 0) {
		return null;
	}
	return (
		<Collapsible
			open={open}
			onOpenChange={onFold}
			render={<section aria-label="More projects" />}
			className="group/more flex flex-col pt-4"
		>
			<CollapsibleTrigger className="flex min-h-10 min-w-0 items-center gap-1.5 px-4 font-medium text-muted-foreground text-xs uppercase tracking-wide outline-none">
				<ChevronRightIcon
					aria-hidden
					className="size-3.5 shrink-0 transition-transform duration-150 group-data-[open]/more:rotate-90"
				/>
				<span className="min-w-0 truncate">
					{idle.length} more {idle.length === 1 ? "project" : "projects"}
				</span>
			</CollapsibleTrigger>
			<CollapsibleContent>
				<ul className="flex flex-col">
					{idle.map((folder) => (
						<li key={folderKey(folder)}>
							<button
								type="button"
								title={`New conversation in ${folder.name}`}
								disabled={onNew === null}
								onClick={() => onNew?.(folder)}
								className="flex min-h-11 w-full min-w-0 items-center gap-3 pr-4 pl-9 text-left text-muted-foreground text-sm active:bg-muted disabled:opacity-60"
							>
								<span className="min-w-0 flex-1 truncate">{folder.name}</span>
								{onNew !== null && (
									<PlusIcon aria-hidden className="size-4 shrink-0" />
								)}
							</button>
						</li>
					))}
				</ul>
			</CollapsibleContent>
		</Collapsible>
	);
}
