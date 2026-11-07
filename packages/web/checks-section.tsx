import { CircleAlertIcon, CircleCheckIcon } from "lucide-react";
import type { JSX } from "react";
import { cn } from "#web/lib/utils.ts";
import { plainLine } from "./before-after";
import { CardSection } from "./card-section";
import { Markdown } from "./markdown";

/** One item of a record's `## Checks`. */
export interface Check {
	/** `- [x]` for what was verified, `- [ ]` for what was not. */
	passed: boolean;
	/** Its line, as markdown. */
	claim: string;
	/** The lines indented under it, as markdown; "" when none. */
	note: string;
}

/** The `- [x]` and `- [ ]` items of `text`, each with the lines indented under it. */
export function checksIn(text: string): Check[] {
	const found: Check[] = [];
	for (const line of text.split("\n")) {
		const item = /^- \[([ xX])\]\s+(.*)$/.exec(line);
		if (item !== null) {
			found.push({
				passed: item[1] !== " ",
				claim: (item[2] ?? "").trim(),
				note: "",
			});
			continue;
		}
		const last = found.at(-1);
		if (last !== undefined && /^\s+\S/.test(line)) {
			last.note = [last.note, line.trim()].filter((each) => each).join(" ");
		}
	}
	return found;
}

/**
 * A merged card's Checks: what was verified and what was not, open by
 * default and folding to their counts. Nothing when `text` lists no checks.
 */
export function ChecksSection({ text }: { text: string }): JSX.Element | null {
	const checks = checksIn(text);
	if (checks.length === 0) {
		return null;
	}
	const passed = checks.filter((each) => each.passed).length;
	const open = checks.length - passed;
	return (
		<CardSection
			label="checks"
			title="Checks"
			open
			peek={
				<span>
					{passed > 0 && (
						<span className="text-success">✓ {passed} passed</span>
					)}
					{passed > 0 && open > 0 && <span aria-hidden> · </span>}
					{open > 0 && (
						<span className="text-warning">! {open} not checked</span>
					)}
				</span>
			}
		>
			<ul className="flex flex-col gap-2">
				{checks.map((check, index) => {
					const Icon = check.passed ? CircleCheckIcon : CircleAlertIcon;
					return (
						<li
							// biome-ignore lint/suspicious/noArrayIndexKey: the list never reorders
							key={index}
							className="flex items-start gap-2"
							aria-label={`${check.passed ? "passed" : "not checked"}: ${plainLine(check.claim)}`}
						>
							<Icon
								aria-hidden
								className={cn(
									"mt-1 size-3.5 shrink-0",
									check.passed ? "text-success" : "text-warning",
								)}
							/>
							<div className="min-w-0">
								<Markdown text={check.claim} className="[&_p]:my-0" />
								{check.note !== "" && (
									<Markdown
										text={check.note}
										className="text-muted-foreground text-xs [&_p]:my-0"
									/>
								)}
							</div>
						</li>
					);
				})}
			</ul>
		</CardSection>
	);
}
