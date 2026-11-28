import type { JSX } from "react";
import { cn } from "#web/lib/utils.ts";

/**
 * Splates' stacked-plate buddy brand mark: two rounded plates with crisp eyes
 * and no agent corner pin.
 */
export function BuddyLogo({ className }: { className?: string }): JSX.Element {
	return (
		<svg
			aria-hidden="true"
			viewBox="0 0 32 32"
			fill="none"
			className={cn("shrink-0", className)}
		>
			<rect
				x="4"
				y="11"
				width="24"
				height="17"
				rx="6"
				className="fill-zinc-200 stroke-zinc-900/15 dark:fill-[#18181d] dark:stroke-white/14"
				strokeWidth="1.2"
			/>
			<rect
				x="3"
				y="6"
				width="26"
				height="19"
				rx="6.5"
				className="fill-white stroke-zinc-900/22 dark:fill-[#2c2c34] dark:stroke-white/22"
				strokeWidth="1.2"
			/>
			<rect
				x="11.8"
				y="12.2"
				width="2.8"
				height="5.6"
				rx="1.4"
				className="fill-zinc-900 dark:fill-[#f4f4f5]"
			/>
			<rect
				x="17.4"
				y="12.2"
				width="2.8"
				height="5.6"
				rx="1.4"
				className="fill-zinc-900 dark:fill-[#f4f4f5]"
			/>
		</svg>
	);
}
