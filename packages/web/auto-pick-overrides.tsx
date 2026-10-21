import type { RuleOverrides } from "@stringsync/splates-server/stats/browser";
import { type JSX, useEffect, useState } from "react";
import { autoPickOverrides } from "./auto-pick-api";

/**
 * The picks the person changed, by the rule that made them: how often, and
 * what they moved to, so a rule overridden often is easy to find and change.
 * Shows nothing until there is one.
 */
export function AutoPickOverrides({
	onRule,
}: {
	/** Sets the page on rule `rule`, from 0. */
	onRule: (rule: number) => void;
}): JSX.Element | null {
	const [rows, setRows] = useState<RuleOverrides[]>([]);
	useEffect(() => {
		let live = true;
		autoPickOverrides().then(
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
		<section aria-label="Overrides" className="flex flex-col gap-2">
			<h3 className="text-sm">Overridden picks</h3>
			<ul className="flex flex-col gap-1 text-sm">
				{rows.map((row) => (
					<li key={row.rule} className="flex flex-wrap items-baseline gap-x-2">
						<button
							type="button"
							className="underline"
							onClick={() => onRule(row.rule)}
						>
							Rule {row.rule + 1}
						</button>
						<span>
							{row.count} {row.count === 1 ? "time" : "times"}
						</span>
						<span className="text-muted-foreground">
							{row.moves
								.map((move) => `${move.aspect} to ${move.to} ×${move.count}`)
								.join(", ")}
						</span>
					</li>
				))}
			</ul>
		</section>
	);
}
