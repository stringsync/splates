import { SparklesIcon } from "lucide-react";
import type { JSX } from "react";
import { cn } from "#web/lib/utils.ts";

/** What the New menu calls the item that lets Auto pick the agent. */
export const AUTO_NAME = "Auto";

/** Auto's mark, in place of an agent's, beside its name in a menu. */
export function AutoIcon({ className }: { className?: string }): JSX.Element {
	return <SparklesIcon aria-hidden className={cn("size-4", className)} />;
}

/** Auto's mark beside its name, as the greeting names an agent. */
export function AutoBrand({ className }: { className?: string }): JSX.Element {
	return (
		<span className={cn("flex items-center gap-2", className)}>
			<AutoIcon className="size-[1em]" />
			{AUTO_NAME}
		</span>
	);
}
