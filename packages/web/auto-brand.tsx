import { SparklesIcon } from "lucide-react";
import type { JSX } from "react";
import { cn } from "#web/lib/utils.ts";

/** What the Start menu calls the item that lets Auto pick the agent. */
export const AUTO_PICK_NAME = "Auto pick";

/**
 * Auto pick's mark, in place of an agent's, beside its name in a menu: golden
 * sparkles, so Auto pick reads at a glance wherever it shows.
 */
export function AutoIcon({ className }: { className?: string }): JSX.Element {
	return (
		<SparklesIcon
			aria-hidden
			className={cn(
				"size-4 fill-yellow-400/40 text-yellow-500 dark:fill-yellow-300/25 dark:text-yellow-400",
				className,
			)}
		/>
	);
}
