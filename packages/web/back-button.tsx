import { ChevronLeftIcon } from "lucide-react";
import type { JSX } from "react";

/**
 * A nested page's way back, leading its bar as a chevron and the name of the
 * page above it, so where it goes is in sight rather than in a tooltip.
 */
export function BackButton({
	parent,
	onBack,
}: {
	/** The page it goes back to, as its own bar titles it. */
	parent: string;
	onBack: () => void;
}): JSX.Element {
	return (
		<button
			type="button"
			aria-label={`Back to ${parent}`}
			onClick={onBack}
			className="-ml-1 flex h-8 min-w-0 max-w-40 shrink-0 items-center gap-0.5 rounded-md pr-2 pl-1 text-muted-foreground text-sm outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring max-md:h-11 max-md:text-base [&_svg]:size-4 max-md:[&_svg]:size-5"
		>
			<ChevronLeftIcon aria-hidden className="shrink-0" />
			<span className="truncate">{parent}</span>
		</button>
	);
}
