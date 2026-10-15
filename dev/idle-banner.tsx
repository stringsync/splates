import { MoonIcon } from "lucide-react";
import type { JSX } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import { cn } from "#dev/lib/utils.ts";
import { IDLE_STOP } from "../conversation-state";
import type { ConversationState } from "../conversations";
import { useNameOf } from "./conversation-names";

/**
 * Under a conversation's header while arbor has its agent stopped for sitting
 * idle, across the pane's padding to its edges: why its process is gone, so
 * the person does not take it for a crash, and what wakes it.
 */
export function IdleBanner({
	handedBy,
	phone,
	onOpen,
}: {
	/** The conversation it reports to, whose word wakes it. */
	handedBy: ConversationState | null;
	phone: boolean;
	onOpen: (id: string) => void;
}): JSX.Element {
	const nameOf = useNameOf();
	return (
		<p
			role="status"
			data-slot="idle-banner"
			className={cn(
				phone ? "-mx-1" : "-mx-4",
				"flex shrink-0 items-center gap-2 border-y bg-muted px-4 py-2 text-muted-foreground text-sm",
			)}
		>
			<MoonIcon className="size-4 shrink-0" />
			<span>
				<span className="font-medium text-foreground">
					Stopped after {IDLE_STOP.mins} minutes idle.
				</span>{" "}
				{handedBy === null ? (
					"Sending a message starts it again where it left off."
				) : (
					<>
						It starts again where it left off when{" "}
						<Button
							variant="link"
							className="h-auto p-0 font-medium"
							onClick={() => onOpen(handedBy.id)}
						>
							{nameOf(handedBy)}
						</Button>{" "}
						tells it something.
					</>
				)}
			</span>
		</p>
	);
}
