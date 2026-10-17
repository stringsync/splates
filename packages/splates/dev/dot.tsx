import type { ComponentProps, JSX } from "react";
import { cn } from "#dev/lib/utils.ts";

/**
 * A colored dot, centered in a box the size of an icon, so it lines up with
 * the icons and other marks beside it. `color` is its background class; the
 * rest goes on the box, as a role and label for a dot that means something
 * on its own.
 */
export function Dot({
	color,
	...box
}: { color: string } & Omit<ComponentProps<"span">, "className">): JSX.Element {
	return (
		<span
			{...box}
			className="flex size-3.5 shrink-0 items-center justify-center"
		>
			<span className={cn("size-2 rounded-full", color)} />
		</span>
	);
}
