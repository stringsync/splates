import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import type { JSX, ReactNode } from "react";
import { Checkbox } from "#web/components/ui/checkbox.tsx";
import type { ScenarioGroup } from "./eval-scenarios";

/** One namespace as a card: its name, how many pass, a bar, a checkbox to pick all of it, and its scenarios folded away or shown. */
export function EvalGroupCard({
	group,
	collapsed,
	picked,
	onToggle,
	onPick,
	children,
}: {
	group: ScenarioGroup;
	collapsed: boolean;
	/** The ids picked in the whole page. */
	picked: string[];
	onToggle: () => void;
	onPick: (ids: string[], on: boolean) => void;
	/** The scenario rows. */
	children: ReactNode;
}): JSX.Element {
	const ids = group.rows.map(({ scenario }) => scenario.id);
	const passing = group.rows.filter(
		({ state }) => state.state === "passing",
	).length;
	const chosen = ids.filter((id) => picked.includes(id)).length;
	return (
		<section
			aria-label={`Group ${group.name}`}
			className="overflow-hidden rounded-xl border bg-card shadow-xs"
		>
			<div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-3.5 py-3 last:border-b-0">
				<Checkbox
					aria-label={`Select group ${group.name}`}
					checked={chosen === ids.length}
					onCheckedChange={(on) => onPick(ids, on === true)}
				/>
				<button
					type="button"
					aria-expanded={!collapsed}
					aria-label={`Fold ${group.name}`}
					onClick={onToggle}
					className="flex items-center gap-1 text-left font-semibold"
				>
					{collapsed ? (
						<ChevronRightIcon className="size-3.5" />
					) : (
						<ChevronDownIcon className="size-3.5" />
					)}
					{group.name}
				</button>
				<span className="text-muted-foreground text-xs">
					{passing} of {ids.length} passing
				</span>
				<div
					aria-hidden
					className="h-1.5 w-24 overflow-hidden rounded-full bg-muted"
				>
					<div
						className="h-full bg-emerald-500"
						style={{ width: `${(passing / ids.length) * 100}%` }}
					/>
				</div>
			</div>
			{!collapsed && <div className="flex flex-col">{children}</div>}
		</section>
	);
}
