import type { Noul } from "./system-one";

// Browser-safe: the page names the classes from here, through `./browser`.

/** One thing the judge says of a task, as the page names it. */
export interface TaskClass<Id extends string> {
	id: Id;
	label: string;
	noul: Noul;
}

export const KIND_IDS = ["bugfix", "design", "open"] as const;
export type KindId = (typeof KIND_IDS)[number];
export const DEPTH_IDS = ["shallow", "moderate", "deep"] as const;
export type DepthId = (typeof DEPTH_IDS)[number];

/** Kinds remain independent questions; the request's length is not a design decision. */
export const KINDS: readonly TaskClass<KindId>[] = [
	question(
		"bugfix",
		"Bugfix",
		"Does the task ask to find and fix a defect: something that fails, crashes or behaves other than it should?",
	),
	question(
		"design",
		"Design",
		"Does implementing the task require choosing between approaches, shaping an API or data model, or weighing trade-offs? Describing an already chosen solution carefully is not itself a design decision.",
	),
	question(
		"open",
		"Open-ended",
		"Is the task open-ended or research-like, with investigation needed before the desired outcome is clear?",
	),
];

/** The hardest reasoning step, independent of how much code or prose there is. */
export const DEPTHS: readonly TaskClass<DepthId>[] = [
	{
		id: "shallow",
		label: "Shallow",
		noul: {
			type: "noul",
			instructions:
				"Is the task's reasoning depth shallow: the hardest step is applying a known, direct change? Judge the work requested, not the length or care of the message, number of files, or amount of testing.",
			criteria: {
				true: "A long, careful message asking for a one-spot change is shallow. So are a specified CSS/layout adjustment, renaming across many files, wiring an existing pattern, or applying an explicit solution. Copying an existing page behavior into a CLI command, or bumping a dependency and threading a specified option through existing calls, is shallow even with tests in several files. Reading nearby code to find the spot does not alone make it moderate.",
				false:
					"The solution needs tracing interacting behavior or deriving an approach (moderate), or resolving subtle competing constraints or an elusive cause (deep).",
			},
		},
	},
	{
		id: "moderate",
		label: "Moderate",
		noul: {
			type: "noul",
			instructions:
				"Is the task's reasoning depth moderate: its hardest step needs tracing behavior or working out an implementation using familiar patterns? Judge reasoning, not the number of files, request length, stakes, or verification effort.",
			criteria: {
				true: "Trace ordinary synchronous behavior, find a localized ordinary bug, or work out how a feature fits existing behavior. Several related constraints need connecting, with a clear approach once understood.",
				false:
					"Applying a specified solution or straightforward existing pattern is shallow, even over many files. Novel architecture, subtle invariants or an elusive failure needing competing hypotheses is deep.",
			},
		},
	},
	{
		id: "deep",
		label: "Deep",
		noul: {
			type: "noul",
			instructions:
				"Is the task's reasoning depth deep: its hardest step requires sustained reasoning about subtle invariants, competing hypotheses, or architectural trade-offs? Size, polished prose, unfamiliar code, high stakes and screenshots alone do not imply deep reasoning.",
			criteria: {
				true: "A concurrency or ordering failure involving asynchronous ownership, teardown, atomicity or persistence; reconciling lifecycle or consistency guarantees; designing a policy that must bound autonomous work and preserve user approval. Even with a suspected cause, proving the fix covers interleavings takes deep reasoning. Architectural or policy trade-offs left unresolved can require deep reasoning. The solution cannot be obtained just by tracing ordinary behavior or following a given plan.",
				false:
					"A routine feature or ordinary bug whose approach emerges by tracing existing behavior is moderate. A specified change or direct pattern is shallow, even if its request is long or many files change.",
			},
		},
	},
];

export const BREADTHS = [
	question(
		"spot",
		"One spot",
		"Is the code the task must read and change confined to one small spot, even if its message is long? Use any file paths supplied in the state as evidence, not as the only files it may touch.",
	),
	question(
		"module",
		"One module",
		"Does the task need reading and changing several related pieces within one module or feature?",
	),
	question(
		"system",
		"Across modules",
		"Does the task need reading and changing several modules or packages? A mechanical rename can have this breadth and still have shallow reasoning depth.",
	),
] as const;
export const CLARITY_IDS = ["settled", "unresolved"] as const;
export type ClarityId = (typeof CLARITY_IDS)[number];

/** How settled the requested behavior is, independent of tone and reasoning depth. */
export const CLARITIES: readonly TaskClass<ClarityId>[] = [
	question(
		"settled",
		"Calls settled",
		"Has the user settled the desired behavior or approach and its consequential choices, leaving implementation calls to the agent? Look for explicit decisions and concrete requirements, not an assertive tone, polished wording or message length. A tentative voice can describe a settled solution. Settled behavior can still require deep reasoning to implement safely.",
	),
	question(
		"unresolved",
		"Calls unresolved",
		"Is the user exploring what should happen or asking for help choosing an approach, leaving consequential product or behavior choices open? Confident phrasing alone does not settle these choices. Do not count routine implementation choices or uncertainty about a bug cause when the desired behavior is clear.",
	),
] as const;
export const STAKES = [
	question(
		"routine",
		"Routine",
		"Is the task a reversible code or presentation change without material risk to stored data, security, migrations or releases?",
	),
	question(
		"sensitive",
		"Sensitive",
		"Does the task involve migrations, stored data integrity, security or credentials, publishing or releases, where an incorrect change has material consequences?",
	),
] as const;
export const VERIFICATIONS = [
	question(
		"automated",
		"Automated",
		"Can the requested behavior be checked adequately with tests, types or other automated checks, without visually inspecting UI, layout or screenshots?",
	),
	question(
		"visual",
		"Needs eyes",
		"Does checking the requested result need visual inspection, such as UI, layout, styling, screenshots or video? Use attachment kinds and names as context, never assume their contents are visible.",
	),
] as const;

/** Context judgments are recorded and explained; clarity also participates in rule matching. */
export const CONTEXT_CLASSES = {
	breadth: BREADTHS,
	clarity: CLARITIES,
	stakes: STAKES,
	verification: VERIFICATIONS,
} as const;

/** A question about the task's words and metadata in the judgment state. */
function question<const Id extends string>(
	id: Id,
	label: string,
	instructions: string,
): TaskClass<Id> {
	return { id, label, noul: { type: "noul", instructions } };
}
