import type { JSX, ReactNode } from "react";
import { Checkbox } from "#web/components/ui/checkbox.tsx";
import { type ScenarioRow, specCount, tallyOf } from "./eval-scenarios";

/** A suite's heading above its cards: a checkbox that picks all of it, its name and how many specs pass. */
export function EvalSuite({
	name,
	rows,
	picked,
	onPick,
	children,
}: {
	name: string;
	rows: ScenarioRow[];
	/** The ids picked in the whole page. */
	picked: string[];
	onPick: (ids: string[], on: boolean) => void;
	/** The suite's group cards. */
	children: ReactNode;
}): JSX.Element {
	return (
		<section aria-label={`Suite ${name}`} className="flex flex-col gap-3">
			<div className="flex items-center gap-x-2.5 px-1">
				<PickBox name={name} rows={rows} picked={picked} onPick={onPick} />
				<h3 className="min-w-0 flex-1 break-words font-semibold">{name}</h3>
				<span className="text-muted-foreground text-xs tabular-nums whitespace-nowrap">
					{rows.filter((row) => row.state.state === "passing").length} of{" "}
					{rows.length} passing
				</span>
			</div>
			<div className="flex flex-col gap-6">{children}</div>
		</section>
	);
}

/** A `describe` group as its own card: a grey band with its name, spec count and standing, then its specs. `name` is null for specs under no group. */
export function EvalGroupCard({
	name,
	rows,
	picked,
	onPick,
	children,
}: {
	name: string | null;
	rows: ScenarioRow[];
	picked: string[];
	onPick: (ids: string[], on: boolean) => void;
	children: ReactNode;
}): JSX.Element {
	const aside = tallyOf(rows);
	const [first = "", ...others] = aside.split(" · ");
	const hasFailing = first.endsWith("failing");
	return (
		<div className="overflow-hidden rounded-xl border bg-card shadow-xs">
			<div className="flex items-center gap-x-2.5 bg-muted/60 px-3.5 py-2.5">
				<PickBox
					name={name ?? "ungrouped specs"}
					rows={rows}
					picked={picked}
					onPick={onPick}
				/>
				<span className="min-w-0 flex-1 break-words">
					{name !== null && (
						<span className="font-semibold text-muted-foreground text-xs uppercase tracking-wider">
							{name}
						</span>
					)}
					<span className="ml-1.5 text-muted-foreground text-xs">
						{name !== null && "· "}
						{specCount(rows.length)}
					</span>
				</span>
				<span className="text-muted-foreground text-xs tabular-nums whitespace-nowrap">
					{hasFailing && <span className="text-destructive">{first}</span>}
					{hasFailing && others.length > 0 && " · "}
					{hasFailing ? others.join(" · ") : aside}
				</span>
			</div>
			<div className="flex flex-col">{children}</div>
		</div>
	);
}

function PickBox({
	name,
	rows,
	picked,
	onPick,
}: {
	name: string;
	rows: ScenarioRow[];
	picked: string[];
	onPick: (ids: string[], on: boolean) => void;
}): JSX.Element {
	const ids = rows.map(({ scenario }) => scenario.id);
	const chosen = ids.filter((id) => picked.includes(id)).length;
	return (
		<Checkbox
			aria-label={`Select ${name}`}
			checked={ids.length > 0 && chosen === ids.length}
			onCheckedChange={(on) => onPick(ids, on === true)}
		/>
	);
}
