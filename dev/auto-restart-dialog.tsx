import { useDisposerEffect, useReactive } from "@webappwiz/react";
import { ArrowRightIcon, Loader2Icon, RotateCwIcon } from "lucide-react";
import { type JSX, useEffect, useState } from "react";
import { Duration, SystemTimer, timeAgo } from "webappwiz/time";
import { Button } from "#dev/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#dev/components/ui/dialog.tsx";
import type { AutoRestart } from "./auto-restart";

/**
 * The countdown to an auto restart, with a way to cancel it or restart at
 * once; then `arbor dev` restarting; then, once back, a fresh start and how
 * long ago, with the page reloaded if the setting asked.
 */
export function AutoRestartDialog({
	restart,
}: {
	restart: AutoRestart;
}): JSX.Element {
	useDisposerEffect((disposer) => disposer.use(restart.start()), [restart]);
	const { state } = useReactive(
		restart,
		(restart) => ({ state: restart.state }),
		["changed"],
	);
	const ago = useAgo(restart, state.step === "back");
	return (
		<Dialog
			open={state.step !== "watching"}
			onOpenChange={(open) => {
				if (!open) {
					restart.cancel();
					restart.dismiss();
				}
			}}
		>
			<DialogContent
				className={state.step === "back" ? "sm:max-w-sm" : "sm:max-w-md"}
				showCloseButton={state.step !== "back"}
			>
				{state.step === "counting" ? (
					<>
						<DialogHeader>
							<DialogTitle>
								{state.reload
									? "Auto restarting and reloading"
									: "Auto restarting"}{" "}
								in <span className="tabular-nums">{clock(state.left.ms)}</span>
							</DialogTitle>
							<DialogDescription>
								arbor dev is behind <Onto onto={state.onto} />, and every agent
								has been idle for a minute.{" "}
								{state.reload
									? "It restarts, then this page reloads."
									: "It restarts, and this page stays as it is."}
							</DialogDescription>
						</DialogHeader>
						<DialogFooter>
							<Button variant="outline" onClick={() => restart.cancel()}>
								Cancel
							</Button>
							<Button onClick={() => void restart.restartNow()}>
								Restart now
							</Button>
						</DialogFooter>
					</>
				) : state.step === "restarting" ? (
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<Loader2Icon className="size-4 animate-spin" />
							Restarting arbor dev
						</DialogTitle>
						<DialogDescription>
							Onto <Onto onto={state.onto} />
							{state.reload ? ", then this page reloads" : ""}.
						</DialogDescription>
					</DialogHeader>
				) : state.step === "back" ? (
					<div className="flex items-start gap-3.5">
						<div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-success/15">
							<RotateCwIcon className="size-4 text-success" />
						</div>
						<div className="flex min-w-0 flex-1 flex-col gap-3">
							<div className="flex flex-col gap-0.5">
								<DialogTitle>
									Fresh start,{" "}
									<span title={new Date(state.at).toLocaleString()}>{ago}</span>
								</DialogTitle>
								<DialogDescription>
									Now on <Onto onto={state.onto} />.{" "}
									{state.reloaded
										? "This page reloaded with it."
										: "This page still runs the old one."}
								</DialogDescription>
							</div>
							<div className="flex gap-2">
								<Button size="sm" onClick={() => restart.dismiss()} autoFocus>
									Back to work
									<ArrowRightIcon />
								</Button>
								{!state.reloaded && (
									<Button
										size="sm"
										variant="outline"
										onClick={() => location.reload()}
									>
										Reload
									</Button>
								)}
							</div>
						</div>
					</div>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

/** `ms` as minutes and seconds, rounded up, as a countdown shows it. */
function clock(ms: number): string {
	const secs = Math.ceil(ms / 1000);
	return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}

/** What a restart brings, a commit or an arbor version, set in monospace. */
function Onto({ onto }: { onto: string }): JSX.Element {
	return <code className="font-mono text-[0.9em]">{onto}</code>;
}

/**
 * How long ago `restart` came back, as words that move each second while
 * `back`.
 */
function useAgo(restart: AutoRestart, back: boolean): string {
	const [, setTicks] = useState(0);
	useEffect(() => {
		if (!back) {
			return;
		}
		const tick = new SystemTimer().setInterval(
			() => setTicks((ticks) => ticks + 1),
			Duration.secs(1),
		);
		return () => tick.dispose();
	}, [back]);
	const ago = restart.ago();
	return ago === null ? "" : timeAgo(ago);
}
