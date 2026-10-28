import { LoaderCircleIcon } from "lucide-react";
import { type JSX, useEffect, useState } from "react";
import { cn } from "#web/lib/utils.ts";

/** How long a write must be pending before the page shows it. */
export const PENDING_DELAY_MS = 150;

/** Whether to show a pending write, once `pending` has held for `delay` ms. */
export function useShowPending(
	pending: boolean,
	delay: number = PENDING_DELAY_MS,
): boolean {
	const [shown, setShown] = useState(false);
	useEffect(() => {
		if (!pending) {
			setShown(false);
			return;
		}
		const timer = setTimeout(() => setShown(true), delay);
		return () => clearTimeout(timer);
	}, [pending, delay]);
	return pending && shown;
}

/**
 * Props for a row or card with a write pending: `aria-busy` at once, dimmed
 * and faded once `shown`; the row disables its own actions on `pending`, so
 * none repeats. Spread onto the row's root.
 */
export function pendingRow(
	pending: boolean,
	shown: boolean,
	className?: string,
): { "aria-busy": boolean; className: string } {
	return {
		"aria-busy": pending,
		className: cn(
			"transition-opacity duration-200",
			shown && "opacity-60",
			className,
		),
	};
}

/** A spinner for a button or menu item with a write pending, faded in with `shown`. */
export function PendingSpinner({
	shown,
	className,
}: {
	shown: boolean;
	className?: string;
}): JSX.Element {
	return (
		<LoaderCircleIcon
			aria-hidden
			className={cn(
				"animate-spin transition-opacity duration-200",
				shown ? "opacity-100" : "opacity-0",
				className,
			)}
		/>
	);
}
