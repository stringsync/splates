import { CircleAlertIcon } from "lucide-react";
import { createContext, type JSX, useContext } from "react";
import { useShowPending } from "./pending";
import type { Sending, Unsent } from "./sending";

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
 * Under a message the server has yet to answer: sending, once that has held
 * a moment, and after a while, `seconds` till it times out.
 */
export function SendingLine({
	seconds,
}: {
	seconds: number | null;
}): JSX.Element | null {
	const shown = useShowPending(true);
	if (!shown && seconds === null) {
		return null;
	}
	return (
		<div
			data-slot="aui_user-message-sending"
			className="text-muted-foreground -mt-1 flex items-center gap-1 ps-1 text-xs"
		>
			{seconds === null ? "Sending…" : `Sending… times out in ${seconds}s`}
		</div>
	);
}

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
