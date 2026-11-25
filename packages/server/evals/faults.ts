import { CAUSES, type Cause, diagnosesOf, withoutDiagnosis } from "./diagnosis";

/** The layers a failed run's fault is counted under on an eval card: the diagnosis causes. */
export const FAULT_LAYERS = CAUSES;

export type FaultLayer = Cause;

/** Failed runs per layer at fault, and the remarks with their `Faults:` list taken out. */
export interface Faults {
	/** Runs each layer is blamed for; a run blaming two layers counts under both. */
	counts: Record<FaultLayer, number>;
	/** The remarks without the `Faults:` list, for reading as prose. */
	prose: string;
}

/**
 * The words a remarks `Faults:` line may name, and the layer each counts under:
 * a scenario's check is grading, like the judge, and agent noise is the skill's
 * to state more plainly.
 */
const WORDS: Record<string, FaultLayer> = {
	harness: "harness",
	judge: "judge",
	scenario: "judge",
	skill: "skill",
	eval: "eval",
	agent: "skill",
	"agent noise": "skill",
	noise: "skill",
};

const HEADING = /^\s*(?:#+\s*)?\**faults\**:?\**\s*$/iu;
const ITEM = /^\s*[-*]\s+(.+?):\s*(.+?)\s*$/u;

/**
 * Reads the `Faults:` list in a batch's remarks, one item per failed run
 * (`- run-000: judge, skill`), or else counts the runs of its `Diagnosis:`
 * list (`diagnosis.ts`) under their causes; null when the remarks have
 * neither. Throws on a word that names no layer, or a diagnosis
 * `diagnosesOf` refuses, so `splates evals remarks` can refuse it.
 */
export function faultsOf(remarks: string): Faults | null {
	const diagnoses = diagnosesOf(remarks);
	const lines = withoutDiagnosis(remarks).split("\n");
	const start = lines.findIndex((line) => HEADING.test(line));
	if (start === -1) {
		return diagnoses === null
			? null
			: { counts: countsOf(diagnoses), prose: lines.join("\n") };
	}
	const counts = zero();
	let end = start + 1;
	for (; end < lines.length; end++) {
		const line = lines[end] ?? "";
		if (line.trim() === "" && end === start + 1) {
			continue;
		}
		const item = ITEM.exec(line);
		if (item === null) {
			break;
		}
		const layers = new Set<FaultLayer>();
		for (const word of (item[2] ?? "")
			.replace(/[`*_]/gu, "")
			.split(/\s*(?:,|\+|\/|&|\band\b)\s*/u)) {
			const key = word.trim().toLowerCase();
			if (key === "") {
				continue;
			}
			const layer = WORDS[key];
			if (layer === undefined) {
				throw new Error(
					`"${word.trim()}" in "${line.trim()}" names no fault layer: use ${Object.keys(WORDS).join(", ")}`,
				);
			}
			layers.add(layer);
		}
		for (const layer of layers) {
			counts[layer] += 1;
		}
	}
	const prose = [...lines.slice(0, start), ...lines.slice(end)]
		.join("\n")
		.replace(/\n{3,}/gu, "\n\n")
		.trim();
	return { counts, prose };
}

function zero(): Record<FaultLayer, number> {
	return { harness: 0, judge: 0, skill: 0, eval: 0 };
}

/** Failed runs per cause; a run counts once under each cause any of its diagnoses names. */
function countsOf(
	diagnoses: NonNullable<ReturnType<typeof diagnosesOf>>,
): Record<FaultLayer, number> {
	const runs = new Map<string, Set<FaultLayer>>();
	for (const diagnosis of diagnoses) {
		for (const run of diagnosis.runs) {
			const causes = runs.get(run) ?? new Set<FaultLayer>();
			for (const cause of diagnosis.causes) {
				causes.add(cause);
			}
			runs.set(run, causes);
		}
	}
	const counts = zero();
	for (const causes of runs.values()) {
		for (const cause of causes) {
			counts[cause] += 1;
		}
	}
	return counts;
}
