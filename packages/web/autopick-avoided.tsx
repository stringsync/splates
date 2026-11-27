import type { Avoided } from "@splates/server/autopick";
import { type JSX, useEffect, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { autopickAvoided, clearAvoided } from "./autopick-api";

/**
 * The models Autopick is passing over for now: the provider errors that
 * put each there, what its status page says, when it is tried again, and a
 * button to try it at once. Shows nothing while every model is healthy.
 */
export function AutopickAvoided(): JSX.Element | null {
	const [rows, setRows] = useState<Avoided[]>([]);
	useEffect(() => {
		let live = true;
		autopickAvoided().then(
			(each) => live && setRows(each),
			() => {},
		);
		return () => {
			live = false;
		};
	}, []);
	if (rows.length === 0) {
		return null;
	}
	return (
		<section
			aria-label="Avoided models"
			className="flex flex-col gap-2 rounded-md border p-3"
		>
			<h3 className="text-sm">
				Avoiding {rows.length} {rows.length === 1 ? "model" : "models"}
			</h3>
			<ul className="flex flex-col gap-3 text-sm">
				{rows.map((row) => (
					<li
						key={`${row.agent}/${row.model ?? ""}`}
						className="flex flex-col gap-1"
					>
						<span>
							{row.agent}
							{row.model === null ? "" : ` ${row.model}`}, skipped until{" "}
							{new Date(row.until).toLocaleTimeString([], {
								hour: "2-digit",
								minute: "2-digit",
							})}
						</span>
						<span className="text-muted-foreground text-xs">
							{row.errors} provider {row.errors === 1 ? "error" : "errors"} in
							the last 30 minutes
							{row.last.status === null ? "" : `, last ${row.last.status}`}
							{row.incident === null ? "" : ` · status page: ${row.incident}`}
						</span>
						<Button
							variant="outline"
							size="sm"
							className="self-start"
							onClick={() =>
								void clearAvoided(row.agent, row.model).then(setRows, () => {})
							}
						>
							Use anyway
						</Button>
					</li>
				))}
			</ul>
		</section>
	);
}
