import { CheckIcon, CopyIcon } from "lucide-react";
import type { JSX, ReactNode } from "react";
import { copiedLabel, useCopy } from "./card";
import { cn } from "./lib/utils";

/**
 * A terminal with a button that copies its whole text, `read` giving it. Like
 * the copy on a message the person sent: in the top corner while the terminal
 * is hovered or the button has focus, always under a finger, which cannot
 * hover, and a check once it has copied.
 */
export function CopyFrame({
	title,
	read,
	children,
	className,
}: {
	title: string;
	read: () => string;
	children: ReactNode;
	className?: string;
}): JSX.Element {
	const { copied, copy } = useCopy();
	const label = copiedLabel(copied, "Copy");
	const Icon = copied.state === "copied" ? CheckIcon : CopyIcon;
	return (
		<div className={cn("group relative rounded-lg", className)}>
			<button
				type="button"
				aria-label={`Copy ${title}`}
				title={label}
				onClick={() => copy(read())}
				className={cn(
					"absolute end-1.5 top-1.5 z-10 inline-flex size-6 items-center justify-center rounded-md text-white/50 outline-none transition-opacity hover:text-white focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:end-0 pointer-coarse:top-0 pointer-coarse:size-10",
					"opacity-0 focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100",
					copied.state === "copied" && "opacity-100",
				)}
			>
				<Icon className="size-3.5" />
			</button>
			{children}
		</div>
	);
}
