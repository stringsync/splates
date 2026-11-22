import { makeAssistantDataUI, useAuiState } from "@assistant-ui/react";
import { ChevronRightIcon, CircleAlertIcon } from "lucide-react";
import { type JSX, useState } from "react";
import { copiedLabel, useCopy } from "./card";
import { InMessage, useCardReply } from "./card-reply";

/** What Retry sends: the agent carries on from where it stopped. */
export const CONTINUE = "Continue";

/** A `data-failed` part: what ended the conversation's last turn. */
export interface Failed {
	error: string;
	/** The agent itself stopped, not only its last turn. */
	stopped: boolean;
}

/**
 * Renders a `data-failed` part at the end of the last reply: that the agent
 * or its turn stopped on an error, the error a click away, selectable and
 * copyable, and a Retry that tells the agent to carry on.
 */
export const FailedUI = makeAssistantDataUI<Failed>({
	name: "failed",
	render: ({ data }) => (
		<InMessage>
			<FailedLine {...data} />
		</InMessage>
	),
});

const link =
	"cursor-pointer rounded-sm font-medium text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring";

function FailedLine({ error, stopped }: Failed): JSX.Element {
	const [open, setOpen] = useState(false);
	const { copied, copy } = useCopy();
	const { reply, sent } = useCardReply();
	const last = useAuiState(
		(state) => state.message.index === state.thread.messages.length - 1,
	);
	const retry = last && sent === null ? (reply?.send ?? null) : null;
	return (
		<div
			role="alert"
			data-slot="failed"
			className="my-2 flex flex-col gap-1 text-sm"
		>
			<div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
				<CircleAlertIcon
					aria-hidden
					className="size-3.5 shrink-0 text-destructive"
				/>
				<span className="font-medium text-foreground">
					{stopped ? "The agent stopped" : "The last turn failed"}
				</span>
				<span aria-hidden className="text-muted-foreground">
					·
				</span>
				<button
					type="button"
					aria-expanded={open}
					onClick={() => setOpen(!open)}
					className="inline-flex cursor-pointer items-center gap-0.5 rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
				>
					{open ? "Hide error" : "Show error"}
					<ChevronRightIcon
						aria-hidden
						className={
							open
								? "size-3.5 rotate-90 transition-transform"
								: "size-3.5 transition-transform"
						}
					/>
				</button>
				{retry !== null && (
					<>
						<span aria-hidden className="text-muted-foreground">
							·
						</span>
						<button
							type="button"
							title={`Sends “${CONTINUE}”`}
							onClick={() => void retry(CONTINUE)}
							className={link}
						>
							Retry
						</button>
					</>
				)}
				{open && (
					<>
						<span aria-hidden className="text-muted-foreground">
							·
						</span>
						<button
							type="button"
							title={copied.state === "failed" ? copied.error : undefined}
							onClick={() => copy(error)}
							className={link}
						>
							<span aria-live="polite">{copiedLabel(copied, "Copy")}</span>
						</button>
					</>
				)}
			</div>
			{open && (
				<p className="ml-5 select-text whitespace-pre-wrap break-words font-mono text-muted-foreground text-xs leading-relaxed">
					{error}
				</p>
			)}
		</div>
	);
}
