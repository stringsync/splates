import { SparklesIcon } from "lucide-react";
import type { JSX } from "react";
import { cn } from "#web/lib/utils.ts";

/** What the Start menu calls the item that lets Auto pick the agent. */
export const AUTO_PICK_NAME = "Auto pick";

/** Auto pick's mark, in place of an agent's, beside its name in a menu. */
export function AutoIcon({ className }: { className?: string }): JSX.Element {
	return <SparklesIcon aria-hidden className={cn("size-4", className)} />;
}
