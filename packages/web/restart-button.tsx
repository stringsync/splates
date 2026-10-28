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
	const { restart, restartBusy, restartDone, version } = useCheckpoint();
	const { stale, unreachable } = useFreshness();
	if (stale && !unreachable && !restartBusy) {
		return <RefreshStatus className="size-11 justify-center md:size-8" />;
	}
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
			size={wide ? "sm" : "icon-lg"}
			className={wide ? "w-full" : "size-11"}
			aria-label={label}
			aria-busy={restartBusy}
			title={label}
			disabled={restartBusy || done}
			onClick={restart}
		>
			{restartBusy ? (
				<RefreshStatus updating />
			) : (
				!done && <RotateCwIcon aria-hidden data-icon="inline-start" />
			)}
			<span className={wide ? undefined : "sr-only"}>{label}</span>
		</Button>
	);
}
