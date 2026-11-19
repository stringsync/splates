import type { Bump } from "@splates/server/ship";
import type { JSX } from "react";
import {
	NativeSelect,
	NativeSelectOption,
} from "./components/ui/native-select";

const BUMPS: Bump[] = ["patch", "minor", "major"];

/**
 * A dropdown of patch, minor or major for the target `name`. Pass `own` to
 * offer the target's own default bump first: pass a null `bump` to select
 * it, and `onBump` gets null when it is chosen.
 */
export function BumpToggle({
	name,
	bump,
	own,
	onBump,
	className,
	// vet-ignore objects-over-callbacks: a React component's props, which are how React passes events
}: {
	name: string;
	bump: Bump | null;
	own?: { value: string; label: string };
	onBump: (bump: Bump | null) => void;
	className?: string;
}): JSX.Element {
	return (
		<NativeSelect
			size="sm"
			className={className}
			aria-label={`${name}'s bump`}
			value={bump ?? own?.value ?? BUMPS[0]}
			onChange={(event) => {
				if (own !== undefined && event.target.value === own.value) {
					onBump(null);
					return;
				}
				const to = BUMPS.find((each) => each === event.target.value);
				if (to !== undefined) {
					onBump(to);
				}
			}}
		>
			{own !== undefined && (
				<NativeSelectOption value={own.value}>{own.label}</NativeSelectOption>
			)}
			{BUMPS.map((each) => (
				<NativeSelectOption key={each} value={each}>
					{each}
				</NativeSelectOption>
			))}
		</NativeSelect>
	);
}
