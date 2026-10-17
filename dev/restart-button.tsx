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
	const { restart, restartBusy, restartDone, version } = useCheckpoint();
	const done = restartDone && !update && !restartBusy;
	if (!update && !restartBusy && !done) {
		return version === null ? null : (
			<span
				title={`Current version: arbor ${version}`}
				className="shrink-0 whitespace-nowrap font-mono text-muted-foreground text-xs"
			>
				v{version}
			</span>
		);
	}
	if (done) {
		return (
			<span
				role="status"
				className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-success text-xs"
			>
				<CheckIcon aria-hidden className="size-3.5" />
				Updated
			</span>
		);
	}
	const label = restartBusy ? "Updating" : "Update";
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
			{label}
		</Button>
	);
}
