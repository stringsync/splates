import { RotateCwIcon } from "lucide-react";
import type { JSX } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { useCheckpoint } from "./checkpoint";
import { RefreshStatus, useFreshness } from "./freshness";

/** The bar's Update button, or the current version when no update is available. */
export function RestartButton({
	wide,
	update,
}: {
	wide: boolean;
	update: boolean;
}): JSX.Element | null {
	const { restart, restartBusy, restartDone, version, slide } = useCheckpoint();
	const { stale, unreachable } = useFreshness();
	if (stale && !unreachable && !restartBusy) {
		return <RefreshStatus />;
	}
	if (restartBusy) {
		return (
			<RefreshStatus
				updating
				description={
					slide === "going"
						? "Waiting for agents to save their progress before the server restarts."
						: slide === "restarting"
							? "Waiting for the updated server to reconnect. This page will reload when it is ready."
							: "Requesting a server update. The server will restart and this page will reload when it is ready."
				}
			/>
		);
	}
	const done = restartDone && !update;
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
	const label = done ? "Updated" : "Update";
	return (
		<Button
			variant="outline"
			size="sm"
			aria-label={label}
			title={label}
			disabled={done}
			onClick={restart}
		>
			{!done && <RotateCwIcon aria-hidden data-icon="inline-start" />}
			<span>{label}</span>
		</Button>
	);
}
