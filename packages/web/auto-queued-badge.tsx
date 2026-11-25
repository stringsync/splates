import { BotIcon } from "lucide-react";
import type { JSX } from "react";
import { cn } from "#web/lib/utils.ts";

/** A small robot on the corner of a row's mark: an agent queued its task on its own. */
export function AutoQueuedBadge({
	small = false,
}: {
	small?: boolean;
}): JSX.Element {
	return (
		<span
			role="img"
			aria-label="auto enqueued"
			title="Auto enqueued"
			className={cn(
				"absolute flex items-center justify-center rounded-full border bg-background text-muted-foreground",
				small ? "-right-1 -bottom-1 size-3" : "-right-0.5 -bottom-0.5 size-4",
			)}
		>
			<BotIcon aria-hidden className={small ? "size-2" : "size-2.5"} />
		</span>
	);
}
