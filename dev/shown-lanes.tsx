import { Columns3Icon, EyeIcon, EyeOffIcon } from "lucide-react";
import {
	DropdownMenuCheckboxItem,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
} from "#dev/components/ui/dropdown-menu.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { LaneState } from "../lanes";
import { touchItems } from "./board";
import type { BarAction } from "./top-bar";

/**
 * Which columns the board shows, picked from its bar: each lane and the
 * untriaged, with how many todos it holds, or all at once. The action says
 * how many are hidden, once one is.
 */
export function shownLanes({
	lanes,
	untriaged,
	hidden,
	onToggle,
	onHide,
}: {
	lanes: LaneState[];
	/** How many todos are in no lane. */
	untriaged: number;
	/** The lanes left out, null for the untriaged. */
	hidden: (number | null)[];
	onToggle: (lane: number | null) => void;
	/** Hides these columns and shows the rest. */
	onHide: (lanes: (number | null)[]) => void;
}): BarAction {
	const columns = [
		{ id: null, name: "Untriaged", count: untriaged },
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
						key={column.id ?? "untriaged"}
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
