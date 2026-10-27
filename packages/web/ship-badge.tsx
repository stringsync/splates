import { SHIP_KEY } from "@stringsync/splates-server/push/browser";
import type { Ship } from "@stringsync/splates-server/ship";
import { ExternalLinkIcon } from "lucide-react";
import { type JSX, useEffect, useRef, useState } from "react";
import { buttonVariants } from "#web/components/ui/button.tsx";
import { sendJson } from "./api";
import { BackgroundOutput } from "./background-output";
import { Output } from "./background-pane";
import type { Opened } from "./worker";

/**
 * Takes the person to the Ships page when a ship's push is tapped: it opens
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

/** What npm waits on the person for in `ship`, with npm's page or a field for its code; nothing while it waits on nothing. */
export function ShipWaiting({ ship }: { ship: Ship }): JSX.Element | null {
	if (ship.waiting === null) {
		return null;
	}
	return (
		<>
			{ship.waiting.kind === "otp" && (
				<OtpForm key={ship.waiting.since} project={ship.project} />
			)}
			{ship.waiting.url !== null && (
				<div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-sm">
					<span className="min-w-0 flex-1">
						{ship.waiting.kind === "login"
							? "npm waits for you to sign in."
							: `npm waits for your second factor to publish ${ship.project}.`}
					</span>
					<a
						href={ship.waiting.url}
						target="_blank"
						rel="noreferrer"
						className={buttonVariants({ size: "sm" })}
					>
						<ExternalLinkIcon />
						Open
					</a>
				</div>
			)}
		</>
	);
}

/** A field for the one-time password npm asks for; the code is sent, not kept. */
function OtpForm({ project }: { project: string }): JSX.Element {
	const [code, setCode] = useState("");
	const [error, setError] = useState<string | null>(null);
	const submit = async () => {
		setError(null);
		try {
			await sendJson(
				`/api/ship/otp?${new URLSearchParams({ project })}`,
				"POST",
				{ code },
			);
			setCode("");
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	};
	return (
		<form
			className="flex flex-col gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-sm"
			onSubmit={(event) => {
				event.preventDefault();
				void submit();
			}}
		>
			<span>npm asks for your one-time password.</span>
			<div className="flex items-center gap-2">
				<input
					value={code}
					onChange={(event) => setCode(event.target.value)}
					inputMode="numeric"
					autoComplete="one-time-code"
					placeholder="123456"
					aria-label="One-time password"
					className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1"
				/>
				<button
					type="submit"
					disabled={code.trim() === ""}
					className={buttonVariants({ size: "sm" })}
				>
					Send
				</button>
			</div>
			{error !== null && (
				<span className="text-destructive text-xs">{error}</span>
			)}
		</form>
	);
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
