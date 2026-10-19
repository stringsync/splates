import { Markdown as Parsed } from "webappwiz/md";

/** A task's SPLATES.md, split into what each tab shows. */
export interface PlanParts {
	/** `## Goal`, as markdown; "" when it has none. */
	goal: string;
	/** `## Next`, as markdown; "" when it has none. */
	steps: string;
	/** `## Verification`, what was checked and what it showed; "" when none. */
	verification: string;
	/** `## Demo`, how to set a demo up; "" when it says none. */
	demo: string;
	/**
	 * `## Notes`, then any other section under its heading, or the whole of
	 * a plan that keeps none of the sections the skill names.
	 */
	notes: string;
}

export function planParts(plan: string | null): PlanParts {
	if (plan === null) {
		return {
			goal: "",
			steps: "",
			verification: "",
			demo: "",
			notes: "",
		};
	}
	const sections = Parsed.parse(plan).sections.filter(
		(section) => section.level === 2,
	);
	const named = (name: string) =>
		sections
			.find((section) => section.heading.toLowerCase() === name)
			?.body.trim() ?? "";
	const known = ["goal", "next", "notes", "blocked", "verification", "demo"];
	const others = sections.filter(
		(section) => !known.includes(section.heading.toLowerCase()),
	);
	const kept = sections.length > others.length;
	const notes = kept
		? [
				named("notes"),
				...others.map(
					(section) => `### ${section.heading}\n\n${section.body.trim()}`,
				),
			]
				.filter((part) => part !== "")
				.join("\n\n")
		: plan.replace(/^\s*#\s[^\n]*/, "").trim();
	return {
		goal: named("goal"),
		steps: named("next"),
		verification: named("verification"),
		demo: named("demo"),
		notes,
	};
}

/** How many of the `- [ ]` steps in `steps` are checked, of how many. */
export function stepsIn(steps: string): { done: number; total: number } {
	const boxes = [...steps.matchAll(/^- \[([ xX])\]/gm)];
	return {
		done: boxes.filter(([, box]) => box !== " ").length,
		total: boxes.length,
	};
}
