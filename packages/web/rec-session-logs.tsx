import type { RecSessionDetail } from "@splates/server/rec/browser";
import { type JSX, useEffect, useState } from "react";
import { recLog } from "./api";

/** The session's command log sources that failed or were cut, each with the command that fetches it again. */
export function FailedLogs({
	session,
}: {
	session: RecSessionDetail;
}): JSX.Element | null {
	const missed = (session.commandLogs ?? []).filter(
		(each) => each.status === "failed" || each.status === "cut",
	);
	if (missed.length === 0) {
		return null;
	}
	return (
		<ul aria-label="Log sources not fetched" className="flex flex-col gap-2">
			{missed.map((each) => (
				<li
					key={each.name}
					className="flex flex-col gap-1 rounded-lg border p-3 text-sm"
				>
					<span>
						<span className="font-mono">{each.name}</span>{" "}
						{each.status === "cut" ? "was cut short" : "was not fetched"}
						{each.note === undefined ? "." : `: ${each.note}`}
					</span>
					{each.retry !== undefined && (
						<span className="text-muted-foreground text-xs">
							Fetch it again with <code>{each.retry}</code>
						</span>
					)}
				</li>
			))}
		</ul>
	);
}

/** A session's log files, one shown at a time. */
export function Logs({
	name,
	files,
}: {
	name: string;
	files: string[];
}): JSX.Element {
	const [file, setFile] = useState(files[0] ?? null);
	const [text, setText] = useState<string | null>(null);
	useEffect(() => {
		setText(null);
		if (file !== null) {
			recLog(name, file).then(setText, () =>
				setText("Could not read this log."),
			);
		}
	}, [name, file]);
	if (file === null) {
		return <p className="text-muted-foreground text-sm">No logs.</p>;
	}
	return (
		<div className="flex flex-col gap-2">
			<div className="flex flex-wrap gap-2">
				{files.map((each) => (
					<button
						key={each}
						type="button"
						aria-pressed={each === file}
						onClick={() => setFile(each)}
						className={`rounded-full border px-3 py-1 text-sm ${each === file ? "border-primary bg-primary/10 text-primary" : "bg-card"}`}
					>
						{each}
					</button>
				))}
			</div>
			<pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg border bg-card p-3 font-mono text-xs">
				{text ?? "Loading…"}
			</pre>
		</div>
	);
}
