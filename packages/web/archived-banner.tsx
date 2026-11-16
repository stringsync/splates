import { ArchiveIcon, XIcon } from "lucide-react";
import { type JSX, useState } from "react";
import { cn } from "#web/lib/utils.ts";
import { bleed } from "./error-banner";

/**
 * Atop an archived conversation, across the pane's padding to its edges,
 * saying so and how it comes back.
 */
export function ArchivedBanner({
	phone,
}: {
	phone: boolean;
}): JSX.Element | null {
	const [dismissed, setDismissed] = useState(false);
	if (dismissed) {
		return null;
	}
	return (
		<p
			role="status"
			className={cn(
				bleed(phone),
				"flex shrink-0 items-center gap-2 border-b bg-muted px-4 py-2 text-muted-foreground text-sm",
			)}
		>
			<ArchiveIcon className="size-4 shrink-0" />
			<span className="min-w-0 flex-1">
				<span className="font-medium text-foreground">
					This conversation is archived.
				</span>{" "}
				Sending a message unarchives it.
			</span>
			<button
				type="button"
				aria-label="Dismiss"
				onClick={() => setDismissed(true)}
				className="-mr-2 ml-auto shrink-0 rounded-md p-1 active:bg-background"
			>
				<XIcon className="size-4" />
			</button>
		</p>
	);
}
