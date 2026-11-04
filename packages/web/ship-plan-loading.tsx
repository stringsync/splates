import type { JSX } from "react";

/** A centered, shimmering Loading while the ship page reads what it shows. */
export function PlanLoading(): JSX.Element {
	return (
		<section
			aria-label="ship plan"
			aria-busy
			className="flex min-h-64 items-center justify-center"
		>
			{
				<p
					role="status"
					aria-label="Loading projects"
					className="w-fit shimmer text-muted-foreground motion-reduce:animate-none"
				>
					Loading
				</p>
			}
		</section>
	);
}
