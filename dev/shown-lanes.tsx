import {
	ChevronDownIcon,
	Columns3Icon,
	EyeIcon,
	EyeOffIcon,
} from "lucide-react";
import type { JSX } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#dev/components/ui/dropdown-menu.tsx";
import type { LaneState } from "../lanes";

/**
 * Which columns the board shows, picked in a menu above it: each lane and
 * the untriaged, with how many todos it holds, or all at once. The button
 * says how many are hidden, once one is.
 */
export function ShownLanes({
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
}): JSX.Element {
	const columns = [
		{ id: null, name: "Untriaged", count: untriaged },
		...lanes.map((lane) => ({
			id: lane.id,
			name: lane.name,
			count: lane.todos.length,
		})),
	];
	const left = columns.filter((column) => hidden.includes(column.id)).length;
	return (
		<DropdownMenu>
			<DropdownMenuTrigger render={<Button size="sm" variant="outline" />}>
				<Columns3Icon data-icon="inline-start" />
				Lanes
				{left > 0 && (
					<span className="text-muted-foreground text-xs">· {left} hidden</span>
				)}
				<ChevronDownIcon data-icon="inline-end" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-64">
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
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
