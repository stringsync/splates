import type { ShipBump } from "@stringsync/splates-server/ship";
import type { JSX } from "react";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "#web/components/ui/toggle-group.tsx";

const BUMPS: { value: ShipBump; label: string }[] = [
	{ value: "patch", label: "Patch" },
	{ value: "minor", label: "Minor" },
	{ value: "major", label: "Major" },
];

/** A release type for a new plan or a pending publish in its cascade. */
export function ShipBumpSelector({
	label,
	value,
	onChange,
	disabled = false,
	className,
}: {
	label: string;
	value: ShipBump;
	onChange: (bump: ShipBump) => void;
	disabled?: boolean;
	className?: string;
}): JSX.Element {
	return (
		<ToggleGroup
			aria-label={label}
			value={[value]}
			onValueChange={(values) => {
				const chosen = values[0] as ShipBump | undefined;
				if (chosen !== undefined) {
					onChange(chosen);
				}
			}}
			variant="outline"
			size="sm"
			spacing={0}
			disabled={disabled}
			className={className}
		>
			{BUMPS.map((each) => (
				<ToggleGroupItem key={each.value} value={each.value}>
					{each.label}
				</ToggleGroupItem>
			))}
		</ToggleGroup>
	);
}
