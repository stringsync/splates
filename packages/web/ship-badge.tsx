import { SHIP_KEY } from "@splates/server/push/browser";
import { useReactive } from "core/react";
import { TerminalIcon } from "lucide-react";
import { type JSX, useEffect, useRef, useState } from "react";
import { BackgroundOutput } from "./background-output";
import { Output } from "./background-pane";
import { cn } from "./lib/utils";
import { CopyFrame } from "./ship-copy";
import type { Opened } from "./worker";

/**
 * Calls `onOpen` when the person taps a ship's push, so the page can show the
 * Ship page; call it once in the app root.
 */
export function useShipPushOpens(onOpen: () => void): void {
	const opened = useRef(onOpen);
	opened.current = onOpen;
	useEffect(() => {
		const url = new URL(location.href);
		if (url.searchParams.get(SHIP_KEY) === "open") {
			// Taken out once read, so a reload leaves the page where it is.
			url.searchParams.delete(SHIP_KEY);
			history.replaceState(history.state, "", url);
			opened.current();
		}
		const workers = navigator.serviceWorker;
		if (workers === undefined) {
			return;
		}
		const heard = (event: MessageEvent<Opened>) => {
			if (event.data?.type === "splates:open" && event.data.key === SHIP_KEY) {
				opened.current();
			}
		};
		workers.addEventListener("message", heard);
		return () => workers.removeEventListener("message", heard);
	}, []);
}

/** What the project's latest ship prints, followed while it runs. */
export function ShipOutput({ project }: { project: string }): JSX.Element {
	const [output] = useState(
		() =>
			new BackgroundOutput(
				`/api/ship/output?${new URLSearchParams({ project })}`,
			),
	);
	useEffect(() => () => output.dispose(), [output]);
	const { printed, status } = useReactive(
		output,
		(output) => ({ printed: output.printed, status: output.status }),
		["changed"],
	);
	const finished = status === "ended" || status === "closed";
	const compact = !printed && finished;
	return (
		<CopyFrame
			title="Terminal"
			read={() => output.text()}
			className="overflow-hidden bg-[#0a0a0a]"
		>
			<div className="flex items-center gap-1.5 border-b border-white/10 px-2 py-1 font-mono text-xs text-white/50">
				<TerminalIcon className="size-3" />
				Terminal
			</div>
			<div className="relative">
				<Output
					output={output}
					className={cn(
						"overflow-hidden p-2 transition-[height] duration-200",
						compact ? "h-10" : "h-56 min-h-40",
					)}
				/>
				{!printed && (
					<div
						role="status"
						className="pointer-events-none absolute inset-0 p-2 font-mono text-[13px] text-white/40"
					>
						{finished ? (
							"This step printed nothing"
						) : (
							<>
								Running…
								<span className="ml-1 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse bg-white/50" />
							</>
						)}
					</div>
				)}
			</div>
		</CopyFrame>
	);
}
