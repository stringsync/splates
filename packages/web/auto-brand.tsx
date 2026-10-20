import { SparklesIcon } from "lucide-react";
import { type JSX, useId } from "react";
import { cn } from "#web/lib/utils.ts";

/** What the Start menu calls the item that lets Auto pick the agent. */
export const AUTO_PICK_NAME = "Auto pick";

/**
 * Auto pick's mark, in place of an agent's, beside its name in a menu. Plain
 * like an agent's icon there; `colored` gives golden sparkles where an
 * agent's mark shows its maker's colors, in the blue-violet-pink gradient that
 * marks AI work across the page.
 */
export function AutoIcon({
	className,
	colored,
}: {
	className?: string;
	colored?: boolean;
}): JSX.Element {
	const gradient = useId();
	if (!colored) {
		return <SparklesIcon aria-hidden className={cn("size-4", className)} />;
	}
	return (
		<SparklesIcon
			aria-hidden
			stroke={`url(#${gradient})`}
			fill={`url(#${gradient})`}
			fillOpacity={0.25}
			className={cn("size-4", className)}
		>
			<defs>
				<linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
					<stop offset="0%" stopColor="#3b82f6" />
					<stop offset="50%" stopColor="#8b5cf6" />
					<stop offset="100%" stopColor="#ec4899" />
				</linearGradient>
			</defs>
		</SparklesIcon>
	);
}
