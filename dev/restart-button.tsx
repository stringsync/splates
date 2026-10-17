import { CheckIcon, Loader2Icon, RotateCwIcon } from "lucide-react";
import type { JSX } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import { useCheckpoint } from "./checkpoint";

/** Restarts directly, keeping progress and the reload's confirmation in place. */
export function RestartButton({
	wide,
	update,
}: {
	wide: boolean;
	update: boolean;
}): JSX.Element | null {
	const { restart, restartBusy, restartDone } = useCheckpoint();
	const done = restartDone && !update && !restartBusy;
	if (!update && !restartBusy && !done) {
		return null;
	}
	if (done) {
		return (
			<span
				role="status"
				className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-success text-xs"
			>
				<CheckIcon aria-hidden className="size-3.5" />
				Restarted
			</span>
		);
	}
	const label = restartBusy ? "Restarting" : "Restart to update";
	return (
		<Button
			variant="outline"
			size={wide ? "sm" : "default"}
			aria-label={label}
			aria-busy={restartBusy}
			title={label}
			disabled={restartBusy}
			onClick={restart}
		>
			{restartBusy ? (
				<Loader2Icon
					aria-hidden
					data-icon="inline-start"
					className="animate-spin"
				/>
			) : (
				<RotateCwIcon aria-hidden data-icon="inline-start" />
			)}
			{restartBusy ? "Restarting" : wide ? "Restart to update" : "Update"}
		</Button>
	);
}
