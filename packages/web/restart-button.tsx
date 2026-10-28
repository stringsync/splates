import { LoaderCircleIcon, RotateCwIcon } from "lucide-react";
import type { JSX } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { useCheckpoint } from "./checkpoint";

/** The bar's Update button, or the current version when no update is available. */
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
		return version === null || !wide ? null : (
			<span
				title={`Current version: splates ${version}`}
				className="shrink-0 whitespace-nowrap font-mono text-muted-foreground text-xs"
			>
				v{version}
			</span>
		);
	}
	const label = restartBusy ? "Updating" : done ? "Updated" : "Update";
	return (
		<Button
			variant="outline"
			size={wide ? "sm" : "default"}
			aria-label={label}
			aria-busy={restartBusy}
			title={label}
			disabled={restartBusy || done}
			onClick={restart}
		>
			{restartBusy ? (
				<LoaderCircleIcon
					aria-hidden
					data-icon="inline-start"
					className="animate-spin"
				/>
			) : (
				!done && <RotateCwIcon aria-hidden data-icon="inline-start" />
			)}
			{label}
		</Button>
	);
}
