import { FolderIcon } from "lucide-react";
import {
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
} from "#web/components/ui/dropdown-menu.tsx";
import { cn } from "#web/lib/utils.ts";
import { touchItems } from "./board";
import type { StatsReport } from "./stats-report";
import type { BarAction } from "./top-bar";

/** The filter's value for every project: no path is empty. */
const ALL = "";

/**
 * The Stats header's project filter: "All projects" first, then each by name.
 * It narrows the page, so unlike the project switcher it navigates nowhere.
 */
export function projectFilter(
	report: StatsReport,
	project: string | null,
	options: { root: string; name: string }[],
): BarAction {
	return {
		label: "Project",
		icon: <FolderIcon />,
		text: options.find((each) => each.root === project)?.name ?? "All projects",
		menuClassName: cn("w-52", touchItems),
		menu: (
			<DropdownMenuRadioGroup
				value={project ?? ALL}
				onValueChange={(root) => void report.filter(root === ALL ? null : root)}
			>
				<DropdownMenuRadioItem value={ALL}>All projects</DropdownMenuRadioItem>
				{options.map((each) => (
					<DropdownMenuRadioItem key={each.root} value={each.root}>
						{each.name}
					</DropdownMenuRadioItem>
				))}
			</DropdownMenuRadioGroup>
		),
	};
}
