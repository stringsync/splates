import { useDisposerEffect, useReactive } from "@webappwiz/react";
import { CheckIcon, Loader2Icon } from "lucide-react";
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
 * once; then `arbor dev` restarting; then, once back, that it restarted and
 * how long ago, and reloaded the page if the setting asked.
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
			<DialogContent className="sm:max-w-md">
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
					<>
						<DialogHeader>
							<DialogTitle className="flex items-center gap-2">
								<CheckIcon className="size-4 text-success" />
								arbor dev restarted
							</DialogTitle>
							<DialogDescription>
								<span
									className="text-foreground"
									title={new Date(state.at).toLocaleString()}
								>
									{ago}
								</span>
								, on its own onto <Onto onto={state.onto} />, with every agent
								idle.{" "}
								{state.reloaded
									? "This page reloaded with it."
									: "This page still runs what it loaded before: reload it for the new one."}
							</DialogDescription>
						</DialogHeader>
						<DialogFooter>
							{!state.reloaded && (
								<Button variant="outline" onClick={() => location.reload()}>
									Reload
								</Button>
							)}
							<Button onClick={() => restart.dismiss()}>Close</Button>
						</DialogFooter>
					</>
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
 * `back`, capitalized to lead a sentence.
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
	const words = ago === null ? "" : timeAgo(ago);
	return words.charAt(0).toUpperCase() + words.slice(1);
}
