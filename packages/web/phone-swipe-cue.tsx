import { ArchiveIcon } from "lucide-react";
import type { JSX, RefObject } from "react";

/** The Archive backing a swipe reveals, which `showPast` marks. */
export function ArchiveBacking({
	backing,
	className,
}: {
	backing: RefObject<HTMLDivElement | null>;
	className: string;
}): JSX.Element {
	return (
		<div
			ref={backing}
			aria-hidden
			className={`${className} items-center justify-end gap-2 bg-primary px-6 font-medium text-primary-foreground text-sm opacity-0`}
		>
			<div data-cue="label" className="flex items-center gap-2 [&_svg]:size-5">
				<ArchiveIcon />
				Archive
			</div>
		</div>
	);
}

/**
 * Marks the backing as one letting go would archive from, or not: the label
 * grows and the backing deepens.
 */
export function showPast(backing: HTMLElement | null, past: boolean): void {
	if (backing === null) {
		return;
	}
	const label = backing.querySelector<HTMLElement>("[data-cue=label]");
	if (label !== null) {
		label.style.transition = "transform 150ms ease-out";
		label.style.transform = past ? "scale(1.15)" : "";
	}
	backing.style.filter = past ? "brightness(0.88)" : "";
}
