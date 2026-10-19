import { SparklesIcon } from "lucide-react";
import type { JSX } from "react";
import { cn } from "#web/lib/utils.ts";

/** What the Start menu calls the item that lets Auto pick the agent. */
export const AUTO_PICK_NAME = "Auto pick";

/**
 * Auto pick's mark, in place of an agent's, beside its name in a menu. Plain
 * like an agent's icon there; `colored` gives golden sparkles where an
 * agent's mark shows its maker's colors.
 */
export function AutoIcon({
	className,
	colored,
}: {
	className?: string;
	colored?: boolean;
}): JSX.Element {
	return (
		<SparklesIcon
			aria-hidden
			className={cn(
				"size-4",
				colored &&
					"fill-yellow-400/40 text-yellow-500 dark:fill-yellow-300/25 dark:text-yellow-400",
				className,
			)}
		/>
	);
}
