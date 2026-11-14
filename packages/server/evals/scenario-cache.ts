import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { Ps } from "core/system";
import type { EvalScenario } from "./launch";

/**
 * Remembers the cases a project's `evals.list` printed for a directory until
 * its git HEAD or a changed file moves, so cards asking together share one
 * spawn. Call `of` with a function that lists them.
 */
export class ScenarioCache {
	private readonly kept = new Map<
		string,
		{ stamp: string; cases: Promise<EvalScenario[]> }
	>();

	constructor(private readonly ps: Ps) {}

	/** The cases for `command` in `dir`, listing them with `list` only when the worktree changed. */
	async of(
		dir: string,
		command: string,
		list: () => Promise<EvalScenario[]>,
	): Promise<EvalScenario[]> {
		const key = `${dir}\0${command}`;
		const stamp = await this.stampOf(dir);
		const hit = this.kept.get(key);
		if (stamp !== null && hit?.stamp === stamp) {
			return hit.cases;
		}
		const cases = list();
		if (stamp === null) {
			return cases;
		}
		this.kept.set(key, { stamp, cases });
		// A failure is not kept.
		cases.catch(() => {
			if (this.kept.get(key)?.cases === cases) {
				this.kept.delete(key);
			}
		});
		return cases;
	}

	/**
	 * What the worktree's files are at: its HEAD commit and the modification
	 * time of each file changed from it. Null when `dir` is not a git tree,
	 * which is never cached.
	 */
	private async stampOf(dir: string): Promise<string | null> {
		const [head, status] = await Promise.all([
			this.ps.spawnCapture(["git", "rev-parse", "HEAD"], { cwd: dir }),
			this.ps.spawnCapture(["git", "status", "--porcelain", "-z", "-uall"], {
				cwd: dir,
			}),
		]);
		if (head.exitCode !== 0 || status.exitCode !== 0) {
			return null;
		}
		const changed = status.stdout
			.split("\0")
			.filter((each) => each.length > 3)
			.map((each) => each.slice(3));
		const times = await Promise.all(
			changed.map(async (file) => {
				try {
					return `${file}:${(await stat(join(dir, file))).mtimeMs}`;
				} catch {
					return `${file}:gone`;
				}
			}),
		);
		return `${head.stdout.trim()}\0${times.join("\0")}`;
	}
}
