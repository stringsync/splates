import { FilterIcon } from "lucide-react";
import {
	DropdownMenuCheckboxItem,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
} from "#web/components/ui/dropdown-menu.tsx";
import { cn } from "#web/lib/utils.ts";
import { touchItems } from "./board";
import type { TaskFilter } from "./task-filter";
import type { BarAction } from "./top-bar";

/**
 * The bar action that picks the projects and tags the page narrows to, shared
 * by the board and the queue. Several of a kind mean any of them.
 */
export function taskFilterAction({
	filter,
	projects,
	tags,
}: {
	filter: TaskFilter;
	/** The projects to offer. */
	projects: string[];
	/** The tags to offer. */
	tags: string[];
}): BarAction {
	const picked = filter.projects.length + filter.tags.length;
	return {
		label: "Filter",
		icon: <FilterIcon />,
		text: picked > 0 ? `${picked}` : undefined,
		menuClassName: cn("w-64", touchItems),
		menu: (
			<DropdownMenuGroup>
				{picked > 0 && (
					<>
						<DropdownMenuItem
							closeOnClick={false}
							onClick={() => filter.clear()}
						>
							Clear filter
						</DropdownMenuItem>
						<DropdownMenuSeparator />
					</>
				)}
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
				{projects.length > 0 && tags.length > 0 && <DropdownMenuSeparator />}
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
		),
	};
}
