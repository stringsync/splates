import type { JSX } from "react";
import { useShowPending } from "./pending";

/** Shows loading progress when reading the ship projects takes more than three seconds. */
export function PlanLoading(): JSX.Element {
	const shown = useShowPending(true, 3000);
	return (
		<section
			aria-label="ship plan"
			aria-busy
			className="flex min-h-64 items-center justify-center"
		>
			{shown && (
				<p
					role="status"
					aria-label="Loading projects"
					className="shimmer text-sm text-muted-foreground motion-reduce:animate-none"
				>
					Loading
				</p>
			)}
		</section>
	);
}
