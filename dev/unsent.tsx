import { CircleAlertIcon } from "lucide-react";
import { createContext, type JSX, useContext } from "react";
import type { Sending, Unsent } from "./conversation-feed";

/** A thread's messages the server refused, and what can be done with each. */
export interface UnsentActions {
	unsent: readonly Unsent[];
	retry: (message: Sending) => void;
	edit: (message: Sending) => void;
}

export const UnsentContext = createContext<UnsentActions>({
	unsent: [],
	retry: () => {},
	edit: () => {},
});

/**
 * Under a message the server refused, the `at`th: that it was not sent, why
 * on hover, and a way to send it again or back to the composer.
 */
export function UnsentLine({ at }: { at: number }): JSX.Element | null {
	const { unsent, retry, edit } = useContext(UnsentContext);
	const each = unsent[at];
	if (each === undefined) {
		return null;
	}
	const link =
		"text-foreground font-medium underline-offset-2 hover:underline focus-visible:underline";
	return (
		<div
			data-slot="aui_user-message-unsent"
			className="text-muted-foreground -mt-1 flex items-center gap-1 ps-1 text-xs"
		>
			<span
				className="text-destructive flex items-center gap-1"
				title={each.why}
			>
				<CircleAlertIcon className="size-3" aria-hidden />
				Couldn't send
			</span>
			<span aria-hidden>·</span>
			<button
				type="button"
				className={link}
				onClick={() => retry(each.message)}
			>
				Retry
			</button>
			<span aria-hidden>·</span>
			<button type="button" className={link} onClick={() => edit(each.message)}>
				Edit
			</button>
		</div>
	);
}
