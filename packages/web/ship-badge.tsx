import { SHIP_KEY } from "@stringsync/splates-server/push/browser";
import { type JSX, useEffect, useRef, useState } from "react";
import { BackgroundOutput } from "./background-output";
import { Output } from "./background-pane";
import type { Opened } from "./worker";

/**
 * Takes the person to the Ship page when a ship's push is tapped: it opens
 * a new window with `?ship=open`, or messages the page already up.
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
		<Output
			output={output}
			className="h-64 overflow-hidden rounded-lg bg-[#0a0a0a] p-2"
		/>
	);
}
