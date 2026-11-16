import { EllipsisIcon } from "lucide-react";
import type { JSX } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#web/components/ui/dropdown-menu.tsx";

/**
 * The head of the ship plan's project list: how many have changes, and a ⋯
 * menu that selects those, selects every project, or clears the choice.
 */
export function ProjectsHeader({
	changed,
	behind,
	disabled,
	canPickChanged,
	allPicked,
	nonePicked,
	pickChanged,
	pickAll,
	clear,
}: {
	/** How many projects have commits since their release. */
	changed: number;
	/** How many pin a version behind what they take from. */
	behind: number;
	disabled: boolean;
	/** Some project with changes is not yet chosen. */
	canPickChanged: boolean;
	allPicked: boolean;
	nonePicked: boolean;
	pickChanged: () => void;
	pickAll: () => void;
	clear: () => void;
}): JSX.Element {
	return (
		<div className="flex items-center gap-2 rounded-t-lg border border-b-0 bg-card px-3 py-2 text-sm">
			<span className="font-medium">Projects</span>
			<span className="text-muted-foreground text-xs">
				{changed === 0 ? "none with changes" : `${changed} with changes`}
				{behind > 0 && ` · ${behind} behind a pin`}
			</span>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Select projects"
							disabled={disabled}
							className="-mr-1 ml-auto"
						/>
					}
				>
					<EllipsisIcon />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-56">
					<DropdownMenuItem disabled={!canPickChanged} onClick={pickChanged}>
						{`Select the ${changed} with changes`}
					</DropdownMenuItem>
					<DropdownMenuItem disabled={allPicked} onClick={pickAll}>
						Select all
					</DropdownMenuItem>
					<DropdownMenuItem disabled={nonePicked} onClick={clear}>
						Clear
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}
