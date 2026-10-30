import { SHIP_KEY } from "@stringsync/splates-server/push/browser";
import { TerminalIcon } from "lucide-react";
import { type JSX, useEffect, useRef, useState } from "react";
import { BackgroundOutput } from "./background-output";
import { Output } from "./background-pane";
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
	return (
		<div className="min-h-48 overflow-hidden rounded-lg bg-[#0a0a0a]">
			<div className="flex items-center gap-1.5 border-b border-white/10 px-2 py-1 font-mono text-xs text-white/50">
				<TerminalIcon className="size-3" />
				Terminal
			</div>
			<Output output={output} className="h-56 min-h-40 overflow-hidden p-2" />
		</div>
	);
}
