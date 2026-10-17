import type { JSX, ReactNode } from "react";
import { Button } from "#dev/components/ui/button.tsx";

/**
 * The one thing to do next under a line of the thread, such as Resume under
 * an interrupted turn: large and centered, so it reads as the way on.
 * `outline` for one that is optional, such as Check in.
 */
export function ThreadAction({
	children,
	outline = false,
	title,
	onClick,
}: {
	children: ReactNode;
	outline?: boolean;
	title?: string;
	onClick: () => void;
}): JSX.Element {
	return (
		<Button
			variant={outline ? "outline" : "default"}
			title={title}
			onClick={onClick}
			className="mt-3 h-11 min-w-48 self-center rounded-full px-8 text-[15px] shadow-xs"
		>
			{children}
		</Button>
	);
}
