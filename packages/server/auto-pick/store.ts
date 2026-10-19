import type { Fs } from "webappwiz/system";
import { fail } from "../exit";
import { DEFAULT_RULES } from "./defaults";
import { type AutoPickRules, checkRules, RULES_FORMAT } from "./rules";

/**
 * The person's Auto pick rules, kept in one file under their home rather than
 * per project, as the roster is: one mapping for every project on the machine.
 */
export class AutoPickStore {
	constructor(
		/** `~/.splates/auto-pick.json`, or a test's own. */
		readonly path: string,
		private readonly deps: { fs: Fs },
	) {}

	/** The rules as the file keeps them; the defaults when there is no file. */
	async rules(): Promise<AutoPickRules> {
		const raw = await this.deps.fs.read(this.path).catch(() => null);
		if (raw === null) {
			return DEFAULT_RULES;
		}
		let json: unknown;
		try {
			json = JSON.parse(raw);
		} catch {
			fail("usage", `${this.path} is not JSON: fix or delete it`, {
				path: this.path,
			});
		}
		const format = (json as { format?: unknown } | null)?.format;
		if (typeof format === "number" && format > RULES_FORMAT) {
			fail(
				"outdated",
				[
					`${this.path} is in format ${format}, written by a newer splates; this one understands up to ${RULES_FORMAT}, so it leaves it alone.`,
					"Run `bunx @stringsync/splates@latest` instead.",
				].join("\n"),
				{ path: this.path, format, understood: RULES_FORMAT },
			);
		}
		const checked = checkRules(json);
		if (!checked.ok) {
			fail(
				"usage",
				`${this.path} is not Auto pick rules: ${checked.problem}. Fix it, or delete it for the defaults`,
				{ path: this.path },
			);
		}
		return checked.rules;
	}

	/** Writes `rules` once they check out, refusing them, file untouched, when not. */
	async save(rules: AutoPickRules): Promise<void> {
		const checked = checkRules(rules);
		if (!checked.ok) {
			fail("usage", `not Auto pick rules: ${checked.problem}`, {
				path: this.path,
			});
		}
		await this.write(checked.rules);
	}

	/** Writes the defaults over the person's rules, returning them. */
	async reset(): Promise<AutoPickRules> {
		await this.write(DEFAULT_RULES);
		return DEFAULT_RULES;
	}

	private async write(rules: AutoPickRules): Promise<void> {
		await this.deps.fs.mkdir(this.path.slice(0, this.path.lastIndexOf("/")), {
			recursive: true,
		});
		// Through a temporary file, so a reader never sees half of it.
		const tmp = `${this.path}.${crypto.randomUUID()}.tmp`;
		await this.deps.fs.write(tmp, `${JSON.stringify(rules, null, "\t")}\n`);
		await this.deps.fs.rename(tmp, this.path);
	}
}
