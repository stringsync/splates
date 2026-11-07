import { type JSX, type ReactNode, useMemo, useState } from "react";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "#web/components/ui/toggle-group.tsx";
import { cn } from "#web/lib/utils.ts";
import { CardSection } from "./card-section";
import { Markdown } from "./markdown";
import { paragraphs } from "./merged-body";
import { planParts } from "./task-plan-parts";

/** A task record's Before and After, as a card or dialog leads with them. */
export interface CardRecord {
	before: string;
	after: string;
	/** Its `## Checks`, what was verified and what was not; "" or absent when none. */
	checks?: string;
}

/**
 * What a card leads with from `plan`, a task's `SPLATES.md` or its merge
 * record's copy of those sections; null when it holds neither section, or
 * only the hints a fresh task starts with.
 */
export function cardRecord(plan: string | null | undefined): CardRecord | null {
	const parts = planParts(plan ?? null);
	const before = withoutHints(parts.before);
	const after = withoutHints(parts.goal);
	const checks = withoutHints(parts.checks);
	return before === "" && after === "" ? null : { before, after, checks };
}

/**
 * A record's opening: Before and After stacked as two sections, each under a
 * level-two heading, its words following its own picture. An After with both Expected and
 * Actual switches between them, opening on Actual. Pass `folds` to let each
 * fold to its first line; both start open. `children` follow After as
 * sections of the same record.
 */
export function BeforeAfter({
	record,
	folds = false,
	className,
	children,
}: {
	record: CardRecord;
	folds?: boolean;
	className?: string;
	children?: ReactNode;
}): JSX.Element {
	const before = useMemo(() => sideOf(record.before), [record.before]);
	const after = useMemo(() => sideOf(record.after), [record.after]);
	return (
		<div className={cn("@container min-w-0 text-sm", className)}>
			<div className="flex min-w-0 flex-col gap-0">
				<Column label="Before" side={before} ruled={false} folds={folds} />
				<Column label="After" side={after} ruled folds={folds} />
				{children}
			</div>
		</div>
	);
}

/** `text` as one line of plain words, its markdown marks dropped. */
export function plainLine(text: string): string {
	return text
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/[`*_]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

function withoutHints(text: string): string {
	return text.replace(/<!--[\s\S]*?-->/g, "").trim();
}

function Column({
	label,
	side,
	ruled,
	folds,
}: {
	label: string;
	side: Side;
	ruled: boolean;
	folds: boolean;
}): JSX.Element {
	const holds = (each: Variant) =>
		side.variants[each].pictures.length + side.variants[each].words.length > 0;
	const both = holds("expected") && holds("actual");
	const [chosen, choose] = useState<Variant>("actual");
	const only = holds("actual") ? "actual" : "expected";
	const shown = both ? chosen : only;
	const pictures = [...side.pictures, ...side.variants[shown].pictures];
	const [line, ...rest] = [...side.words, ...side.variants[shown].words];
	return (
		<CardSection
			ruled={ruled}
			label={label.toLowerCase()}
			peek={folds ? plainLine(line ?? "Empty") : undefined}
			open
			title={
				<span>
					{label}
					{!both && holds(only) && (
						<span className="font-normal"> · {NAMES[shown]}</span>
					)}
				</span>
			}
			aside={
				both && (
					<ToggleGroup
						aria-label="Expected or Actual"
						variant="outline"
						size="sm"
						spacing={0}
						value={[chosen]}
						onValueChange={(value: string[]) => {
							const next = value[0];
							if (next === "expected" || next === "actual") {
								choose(next);
							}
						}}
					>
						{VARIANTS.map((each) => (
							<ToggleGroupItem
								key={each}
								value={each}
								className="data-pressed:bg-foreground data-pressed:text-background data-pressed:hover:bg-foreground data-pressed:hover:text-background pointer-coarse:h-9 pointer-coarse:px-3 pointer-coarse:text-sm"
							>
								{NAMES[each]}
							</ToggleGroupItem>
						))}
					</ToggleGroup>
				)
			}
		>
			<div className="flex min-w-0 flex-col gap-2">
				{pictures.length === 0 && line === undefined && (
					<p className="m-0 text-muted-foreground italic">Empty</p>
				)}
				{pictures.length > 0 && (
					<div className="min-w-0">
						<Markdown text={pictures.join("\n\n")} />
					</div>
				)}
				{line !== undefined && (
					<div className="flex min-w-0 flex-col gap-1">
						<Markdown
							text={line}
							className="[&_p:first-child]:mt-0 [&_p:last-child]:mb-0"
						/>
						{rest.length > 0 && <Markdown text={rest.join("\n\n")} />}
					</div>
				)}
			</div>
		</CardSection>
	);
}

const VARIANTS: readonly Variant[] = ["expected", "actual"];

const NAMES: Record<Variant, string> = {
	expected: "Expected",
	actual: "Actual",
};

type Variant = "expected" | "actual";

/** One column of a record, its pictures apart from its words. */
export interface Side {
	/** Pictures no label claims. */
	pictures: string[];
	/** What each label holds, as `*Expected*` and `*Actual*` mark it. */
	variants: Record<Variant, { pictures: string[]; words: string[] }>;
	/** Everything else, its one line first. */
	words: string[];
}

/** A paragraph opening with a label, in emphasis or before a colon. */
const LABEL =
	/^(?:[*_]+(expected|actual|as built)[*_]*:?[*_]*|(expected|actual|as built)\s*:)\s*(.*)$/is;

/**
 * Splits a Before or After for its column: pass the section's markdown, and get
 * back its pictures and words, with what `*Expected*` and `*Actual*` each hold.
 */
export function sideOf(text: string): Side {
	// A label holds the pictures after it, and the words on its line or else
	// the one paragraph after it. An older record's As built is its Actual.
	const side: Side = {
		pictures: [],
		variants: {
			expected: { pictures: [], words: [] },
			actual: { pictures: [], words: [] },
		},
		words: [],
	};
	let open: Variant | null = null;
	for (const each of paragraphs(text)) {
		const label = LABEL.exec(each);
		if (label !== null) {
			const name = (label[1] ?? label[2] ?? "").toLowerCase();
			open = name === "expected" ? "expected" : "actual";
			const caption = (label[3] ?? "").replace(/^[\s,:;.-]+/, "");
			if (caption !== "") {
				side.variants[open].words.push(
					caption.charAt(0).toUpperCase() + caption.slice(1),
				);
			}
			continue;
		}
		const picture = each.startsWith("![");
		if (open !== null) {
			const held = side.variants[open];
			if (picture) {
				held.pictures.push(each);
				continue;
			}
			if (held.pictures.length + held.words.length === 0) {
				held.words.push(each);
				continue;
			}
		}
		open = null;
		(picture ? side.pictures : side.words).push(each);
	}
	return side;
}
