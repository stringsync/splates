import type { Bump } from "@splates/server/ship";
import type { JSX } from "react";
import {
	NativeSelect,
	NativeSelectOption,
} from "./components/ui/native-select";

const BUMPS: Bump[] = ["patch", "minor", "major"];

/** A dropdown of patch, minor or major for the target `name`, `bump` selected. */
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
		<NativeSelect
			size="sm"
			className={className}
			aria-label={`${name}'s bump`}
			value={bump}
			onChange={(event) => {
				const to = BUMPS.find((each) => each === event.target.value);
				if (to !== undefined) {
					onBump(to);
				}
			}}
		>
			{BUMPS.map((each) => (
				<NativeSelectOption key={each} value={each}>
					{each}
				</NativeSelectOption>
			))}
		</NativeSelect>
	);
}
