import type { Bump } from "@splates/server/ship";
import type { JSX } from "react";
import { ToggleGroup, ToggleGroupItem } from "./components/ui/toggle-group";

const BUMPS: Bump[] = ["patch", "minor", "major"];

/** Patch, minor or major for the target `name`, `bump` pressed. */
export function BumpToggle({
	name,
	bump,
	onBump,
	className,
	// vet-ignore objects-over-callbacks: a React component's props, which are how React passes events
}: {
	name: string;
	bump: Bump;
	onBump: (bump: Bump) => void;
	className?: string;
}): JSX.Element {
	return (
		<ToggleGroup
			aria-label={`${name}'s bump`}
			variant="outline"
			size="sm"
			spacing={0}
			value={[bump]}
			className={className}
			onValueChange={(value: string[]) => {
				const to = BUMPS.find((each) => each === value[0]);
				if (to !== undefined) {
					onBump(to);
				}
			}}
		>
			{BUMPS.map((each) => (
				<ToggleGroupItem
					key={each}
					value={each}
					className="h-7 min-w-0 px-1.5 text-xs group-data-[spacing=0]/toggle-group:px-1.5 data-pressed:bg-primary data-pressed:text-primary-foreground data-pressed:hover:bg-primary data-pressed:hover:text-primary-foreground"
				>
					{each}
				</ToggleGroupItem>
			))}
		</ToggleGroup>
	);
}
