import type { Noul } from "./system-one";

// Browser-safe: the page names the classes from here, through `./browser`.

/** One thing the judge says of a task, as the page names it. */
export interface TaskClass<Id extends string> {
	id: Id;
	/** A word or two for the page, such as `Mechanical`. */
	label: string;
	/** What the judge is asked, of the task's `subject` and `detail`. */
	noul: Noul;
}

/** What kind of work a task is, by id. */
export const KIND_IDS = [
	"lookup",
	"mechanical",
	"bugfix",
	"design",
	"open",
] as const;

export type KindId = (typeof KIND_IDS)[number];

/** How hard a task's work is, from the least, by id. */
export const DIFFICULTY_IDS = ["easy", "medium", "hard"] as const;

export type DifficultyId = (typeof DIFFICULTY_IDS)[number];

/**
 * The kinds of work, each asked on its own, so a task can be more than one,
 * such as a bugfix that needs a design decision.
 */
export const KINDS: readonly TaskClass<KindId>[] = [
	{
		id: "lookup",
		label: "Lookup",
		noul: {
			type: "noul",
			instructions:
				"Is the task in `subject` and `detail` a quick question or lookup, answerable in a few minutes without changing code?",
		},
	},
	{
		id: "mechanical",
		label: "Mechanical",
		noul: {
			type: "noul",
			instructions:
				"Does the task in `subject` and `detail` ask for a mechanical, well-specified change, saying what to change and how?",
		},
	},
	{
		id: "bugfix",
		label: "Bugfix",
		noul: {
			type: "noul",
			instructions:
				"Does the task in `subject` and `detail` ask to find and fix a defect: something that fails, crashes or behaves other than it should?",
		},
	},
	{
		id: "design",
		label: "Design",
		noul: {
			type: "noul",
			instructions:
				"Does the task in `subject` and `detail` need a design decision: choosing between approaches, shaping an API or data model, or weighing trade-offs?",
		},
	},
	{
		id: "open",
		label: "Open-ended",
		noul: {
			type: "noul",
			instructions:
				"Is the task in `subject` and `detail` open-ended or research-like, with much to investigate before the work is clear?",
		},
	},
];

/**
 * How hard the work is, each asked on its own: how much reasoning it takes
 * and how much of the system it reaches into. The three split one scale, so
 * each says where it ends and the next begins.
 */
export const DIFFICULTIES: readonly TaskClass<DifficultyId>[] = [
	{
		id: "easy",
		label: "Easy",
		noul: {
			type: "noul",
			instructions:
				"Is the task in `subject` and `detail` easy: little reasoning, confined to one file or one small spot, done in one short pass?",
			criteria: {
				true: "One place to look or change and an obvious way to do it, such as answering a question, renaming, fixing a typo, or a small edit the task spells out.",
				false:
					"It takes working out how something behaves, several files, or more than one step to get right.",
			},
		},
	},
	{
		id: "medium",
		label: "Medium",
		noul: {
			type: "noul",
			instructions:
				"Is the task in `subject` and `detail` of medium difficulty: some reasoning across a few related files in one part of the system, with a clear way through once it is understood?",
			criteria: {
				true: "A feature or fix within one module or a few files, where understanding the code nearby is enough to see the way.",
				false:
					"Either trivial and confined to one spot, or reaching across several parts of the system, or needing deep reasoning, design or investigation.",
			},
		},
	},
	{
		id: "hard",
		label: "Hard",
		noul: {
			type: "noul",
			instructions:
				"Is the task in `subject` and `detail` hard: deep reasoning, reaching across several parts of the system, or much to investigate or decide before the way is clear?",
			criteria: {
				true: "A cross-cutting change, a redesign, a hard bug whose cause is unknown, or work that weighs trade-offs across many files.",
				false:
					"The way through is clear once the code nearby is read, and the change stays in one part of the system.",
			},
		},
	},
];
