import { FilterIcon, XIcon } from "lucide-react";
import type { JSX } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "#web/components/ui/dropdown-menu.tsx";
import { cn } from "#web/lib/utils.ts";
import { touchItems } from "./board";
import type { TaskFilter } from "./task-filter";

/**
 * Lets a person narrow a page's tasks by project. Put it under the page's
 * bar with the `projects` to offer; each pick shows as a chip that removes it.
 */
export function TaskFilterBar({
	filter,
	projects,
}: {
	filter: TaskFilter;
	/** The projects to offer. */
	projects: string[];
}): JSX.Element {
	const picks = filter.projects;
	return (
		<fieldset
			aria-label="Filter"
			className="flex min-w-0 flex-wrap items-center gap-2 border-0 p-0"
		>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={<Button variant="outline" size="xs" title="Filter" />}
				>
					<FilterIcon />
					Filter
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" className={cn("w-64", touchItems)}>
					<DropdownMenuGroup>
						{projects.length > 0 && (
							<>
								<DropdownMenuLabel>Project</DropdownMenuLabel>
								{projects.map((project) => (
									<DropdownMenuCheckboxItem
										key={`project:${project}`}
										checked={filter.projects.includes(project)}
										onCheckedChange={() => filter.toggleProject(project)}
									>
										{project}
									</DropdownMenuCheckboxItem>
								))}
							</>
						)}
						{projects.length === 0 && (
							<DropdownMenuLabel>No projects yet</DropdownMenuLabel>
						)}
					</DropdownMenuGroup>
				</DropdownMenuContent>
			</DropdownMenu>
			{picks.map((name) => (
				<span
					key={name}
					className="inline-flex items-center h-6 gap-0.5 rounded-md bg-accent pr-0.5 pl-2 text-foreground text-xs"
				>
					{name}
					<button
						type="button"
						aria-label={`Remove filter ${name}`}
						title={`Remove filter ${name}`}
						className="flex size-5 items-center justify-center rounded outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring max-md:size-8 [&_svg]:size-3"
						onClick={() => filter.toggleProject(name)}
					>
						<XIcon />
					</button>
				</span>
			))}
			{picks.length > 0 && (
				<Button variant="ghost" size="xs" onClick={() => filter.clear()}>
					Clear all
				</Button>
			)}
		</fieldset>
	);
}
