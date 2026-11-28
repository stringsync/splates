import type { JSX } from "react";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
} from "#web/components/ui/empty.tsx";
import { cn } from "#web/lib/utils.ts";

/**
 * A compact empty folder, leaving its header and New action available. It
 * stands as tall as one conversation row (the phone inbox's are taller), so
 * archiving the last one does not shift what lies below.
 */
export function ProjectEmpty({
	phone = false,
}: {
	phone?: boolean;
}): JSX.Element {
	return (
		<Empty
			className={cn(
				"justify-center p-0",
				phone ? "min-h-16 px-4" : "min-h-8 pointer-coarse:min-h-10 px-3",
			)}
		>
			<EmptyHeader>
				<EmptyDescription className={phone ? "text-[13px]" : "text-xs"}>
					No conversations
				</EmptyDescription>
			</EmptyHeader>
		</Empty>
	);
}
