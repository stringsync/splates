import type { LaneState } from "@splates/server/board";
import { Columns3Icon, EyeIcon, EyeOffIcon } from "lucide-react";
import {
	DropdownMenuCheckboxItem,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
} from "#web/components/ui/dropdown-menu.tsx";
import { cn } from "#web/lib/utils.ts";
import { touchItems } from "./board";
import type { BarAction } from "./top-bar";

/**
 * Which columns the board shows, picked from its bar: each lane,
 * with how many todos it holds, or all at once. The action says
 * how many are hidden, once one is.
 */
export function shownLanes({
	lanes,
	hidden,
	onToggle,
	onHide,
	// vet-ignore objects-over-callbacks: a hook's arguments that wire the toolbar's controls to the page
}: {
	lanes: LaneState[];
	/** The lanes left out. */
	hidden: number[];
	onToggle: (lane: number) => void;
	/** Hides these columns and shows the rest. */
	onHide: (lanes: number[]) => void;
}): BarAction {
	const columns = [
		...lanes.map((lane) => ({
			id: lane.id,
			name: lane.name,
			count: lane.todos.length,
		})),
	];
	const left = columns.filter((column) => hidden.includes(column.id)).length;
	return {
		label: "Lanes",
		icon: <Columns3Icon />,
		text: left > 0 ? `${left} hidden` : undefined,
		menuClassName: cn("w-64", touchItems),
		menu: (
			<DropdownMenuGroup>
				<DropdownMenuLabel>Show on the board</DropdownMenuLabel>
				<DropdownMenuItem
					closeOnClick={false}
					onClick={() =>
						onHide(left > 0 ? [] : columns.map((column) => column.id))
					}
				>
					{left > 0 ? <EyeIcon /> : <EyeOffIcon />}
					{left > 0 ? "Show all" : "Hide all"}
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				{columns.map((column) => (
					<DropdownMenuCheckboxItem
						key={column.id}
						checked={!hidden.includes(column.id)}
						onCheckedChange={() => onToggle(column.id)}
					>
						<span className="min-w-0 flex-1 truncate">{column.name}</span>
						<span className="text-muted-foreground text-xs tabular-nums">
							{column.count}
						</span>
					</DropdownMenuCheckboxItem>
				))}
			</DropdownMenuGroup>
		),
	};
}
