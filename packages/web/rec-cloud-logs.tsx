import type { RecLogChoice } from "@splates/server/rec/browser";
import type { JSX } from "react";
import { Badge } from "#web/components/ui/badge.tsx";
import { Switch } from "#web/components/ui/switch.tsx";

/**
 * Lets the person pick which of the project's `rec.logs` sources rec fetches
 * at Stop. Pass the declared `logs` and what is ticked as `chosen`, keyed
 * `logs:<name>`; `choose` hears each switch.
 */
export function RecCloudLogs({
	logs,
	error,
	chosen,
	choose,
}: {
	logs: RecLogChoice[];
	/** Why the project's `rec.logs` could not be read. */
	error?: string;
	chosen: Record<string, boolean>;
	choose: (name: string, on: boolean) => void;
}): JSX.Element | null {
	if (error !== undefined) {
		return (
			<span className="text-muted-foreground text-xs">
				Cloud logs are not offered: {error}
			</span>
		);
	}
	if (logs.length === 0) {
		return null;
	}
	return (
		<ul
			aria-label="Cloud logs"
			className="flex flex-col divide-y rounded-md border px-3"
		>
			<li className="-mx-3 flex items-center gap-3 bg-muted/40 px-3 py-2">
				<span className="flex-1 truncate font-medium text-xs">
					Cloud logs
					<span className="ml-2 font-normal text-muted-foreground">
						fetched at Stop for the recording's window
					</span>
				</span>
			</li>
			{logs.map((each) => (
				<li
					key={each.name}
					className="flex items-center gap-3 py-2"
					title={each.command}
				>
					<Badge variant="secondary">Logs</Badge>
					<span className="flex-1 truncate text-xs">
						{each.label ?? <span className="font-mono">{each.name}</span>}
					</span>
					<Switch
						aria-label={`Fetch ${each.label ?? each.name}`}
						checked={chosen[`logs:${each.name}`] ?? false}
						onCheckedChange={(next) => choose(each.name, next)}
					/>
				</li>
			))}
		</ul>
	);
}
