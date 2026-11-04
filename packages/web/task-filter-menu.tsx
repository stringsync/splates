import { FilterIcon, XIcon } from "lucide-react";
import type { JSX } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#web/components/ui/dropdown-menu.tsx";
import { cn } from "#web/lib/utils.ts";
import { touchItems } from "./board";
import type { TaskFilter } from "./task-filter";

/**
 * Where a person narrows the tasks a page shows by project and tag. Put it
 * under the page's bar, with the options it can offer; each pick shows as a
 * chip that removes it, so a filter that hides tasks is never out of sight.
 */
export function TaskFilterBar({
	filter,
	projects,
	tags,
}: {
	filter: TaskFilter;
	/** The projects to offer. */
	projects: string[];
	/** The tags to offer. */
	tags: string[];
}): JSX.Element {
	const picks = [
		...filter.projects.map((name) => ({ name, project: true })),
		...filter.tags.map((name) => ({ name, project: false })),
	];
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
						{projects.length > 0 && tags.length > 0 && (
							<DropdownMenuSeparator />
						)}
						{tags.length > 0 && (
							<>
								<DropdownMenuLabel>Tag</DropdownMenuLabel>
								{tags.map((tag) => (
									<DropdownMenuCheckboxItem
										key={`tag:${tag}`}
										checked={filter.tags.includes(tag)}
										onCheckedChange={() => filter.toggleTag(tag)}
									>
										{tag}
									</DropdownMenuCheckboxItem>
								))}
							</>
						)}
						{projects.length === 0 && tags.length === 0 && (
							<DropdownMenuLabel>No projects or tags yet</DropdownMenuLabel>
						)}
					</DropdownMenuGroup>
				</DropdownMenuContent>
			</DropdownMenu>
			{picks.map(({ name, project }) => (
				<span
					key={`${project ? "project" : "tag"}:${name}`}
					className="inline-flex items-center h-6 gap-0.5 rounded-md bg-accent pr-0.5 pl-2 text-foreground text-xs"
				>
					{name}
					<button
						type="button"
						aria-label={`Remove filter ${name}`}
						title={`Remove filter ${name}`}
						className="flex size-5 items-center justify-center rounded outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring max-md:size-8 [&_svg]:size-3"
						onClick={() =>
							project ? filter.toggleProject(name) : filter.toggleTag(name)
						}
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
