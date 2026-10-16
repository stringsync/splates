import { FolderGit2Icon } from "lucide-react";
import type { JSX } from "react";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#dev/components/ui/popover.tsx";
import type { ProjectRef } from "../conversation-host";
import { projectUrl } from "./project-places";

/**
 * Another arbor project a message mentions as `#slug`: its name, opening to
 * the directory the agent is told it sits in, and a way to go to it.
 */
export function ProjectChip({ project }: { project: ProjectRef }): JSX.Element {
	return (
		<Popover>
			<PopoverTrigger
				onClick={(event) => event.stopPropagation()}
				className={`${CHIP} cursor-pointer hover:bg-muted`}
			>
				<FolderGit2Icon aria-hidden className="size-3 shrink-0" />
				<span className="min-w-0 truncate">{project.slug}</span>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-72 gap-1 p-3">
				<div className="flex items-center gap-2 font-medium text-sm">
					<FolderGit2Icon
						aria-hidden
						className="size-4 text-muted-foreground"
					/>
					{project.slug}
				</div>
				<p className="break-all font-mono text-muted-foreground text-xs">
					{project.root}
				</p>
				<a
					href={projectUrl(project)}
					className="pt-1 text-primary text-xs hover:underline"
				>
					Open project
				</a>
			</PopoverContent>
		</Popover>
	);
}

const CHIP =
	"inline-flex h-6 max-w-full items-center gap-1.5 rounded-md border px-1.5 align-middle font-mono text-foreground/90 text-xs";
