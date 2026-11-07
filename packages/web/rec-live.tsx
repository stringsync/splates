import type { RecState } from "@splates/server/rec/browser";
import { Laser, Mic, MicOff, SquareIcon } from "lucide-react";
import { type JSX, useEffect, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { closeRec } from "./api";

/** Shows the running rec, and ends it with Close rec. */
export function Live({
	status,
	host,
	onClosed,
}: {
	status: RecState["status"];
	host: string;
	onClosed: () => void;
}): JSX.Element {
	const [closing, setClosing] = useState(false);
	const [problem, setProblem] = useState<string | null>(null);
	const close = async () => {
		setClosing(true);
		setProblem(null);
		try {
			await closeRec();
			onClosed();
		} catch (error) {
			setProblem((error as Error).message);
		} finally {
			setClosing(false);
		}
	};
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const every = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(every);
	}, []);
	const recording = status.recording === true;
	const elapsed =
		recording && status.startedAt !== undefined
			? Math.max(0, Math.floor((now - status.startedAt) / 1000))
			: null;
	return (
		<div className="flex flex-col gap-4 rounded-lg border bg-card p-4">
			<div className="flex flex-col gap-0.5">
				<span className="font-medium font-mono text-sm">{status.name}</span>
				<span className="text-muted-foreground text-xs">
					{recording ? "Recording" : "Waiting for Start"} in Chrome on {host}
				</span>
			</div>
			<div className="flex items-center gap-2 rounded-md border px-3 py-3">
				<div className="flex items-center gap-2 pr-1">
					<span
						className={
							recording
								? "size-2.5 rounded-full bg-destructive shadow-[0_0_0_4px] shadow-destructive/20"
								: "size-2.5 rounded-full bg-muted-foreground/40"
						}
					/>
					<span className="font-mono text-lg tabular-nums">
						{elapsed === null
							? "0:00"
							: `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`}
					</span>
				</div>
				{status.mic !== undefined && (
					<div className="flex h-8 items-center gap-1.5 rounded-md bg-secondary px-2.5">
						{status.mic === "on" ? (
							<Mic className="size-4" />
						) : (
							<MicOff className="size-4" />
						)}
					</div>
				)}
				{status.laser !== undefined && (
					<div
						className={
							status.laser
								? "flex h-8 items-center rounded-md bg-secondary px-2 text-foreground"
								: "flex h-8 items-center rounded-md bg-secondary px-2 text-muted-foreground"
						}
					>
						<Laser className="size-4" />
					</div>
				)}
			</div>
			<div className="flex items-end justify-between gap-3">
				<span className="flex flex-col gap-1 text-muted-foreground text-xs">
					<span>
						Start and Stop stay in Chrome's side panel. Each Stop saves a
						session, then transcribes and ranks it.
					</span>
					<span>
						Close rec saves anything recording, closes rec's Chrome and ends
						rec.
					</span>
					{problem !== null && (
						<span className="text-destructive">{problem}</span>
					)}
				</span>
				<Button
					type="button"
					variant="destructive"
					size="sm"
					disabled={closing}
					onClick={close}
				>
					<SquareIcon className="size-3 fill-current" />
					{closing ? "Closing…" : "Close rec"}
				</Button>
			</div>
		</div>
	);
}
