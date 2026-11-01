import { fail } from "../exit";
import type { Config } from "./config";

const TAG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * The tags a repository's tasks may carry, from a config's `tags`: free
 * labels that group tasks, which ships, queues and the merge gate ignore.
 */
export class Tags {
	private readonly allowed: string[] | null;
	private readonly required: boolean;

	constructor(config: Pick<Config, "tags">) {
		this.allowed = config.tags?.allowed ?? null;
		this.required = config.tags?.required ?? false;
	}

	/**
	 * The tags `raw` names, each flag value a tag or a comma list, lowercase
	 * with dashes and without repeats. Throws `usage` on one that is not.
	 */
	parse(raw: string[]): string[] {
		const tags = raw
			.flatMap((each) => each.split(","))
			.map((each) => each.trim())
			.filter((each) => each !== "");
		for (const tag of tags) {
			if (!TAG.test(tag)) {
				fail(
					"usage",
					`a tag is lowercase letters and digits joined by dashes: not '${tag}'`,
					{ tag },
				);
			}
		}
		return [...new Set(tags)];
	}

	/** Throws `usage` on a tag the config does not allow, naming the ones it does. */
	check(tags: string[]): void {
		if (this.allowed === null) {
			return;
		}
		const unknown = tags.find((tag) => !this.allowed?.includes(tag));
		if (unknown !== undefined) {
			fail(
				"usage",
				`no tag '${unknown}' in splates.config.ts: ${this.allowed.join(", ")}`,
				{ tag: unknown, allowed: this.allowed },
			);
		}
	}

	/**
	 * The tags a new task carries: `named` if any, else the allowed tag the
	 * folder it is added from (relative to the root, empty at it) is called
	 * or lies in. Throws `usage` on one not allowed, and on none when the
	 * config requires one and `needed` says this task must have it.
	 */
	forNew(named: string[], folder: string, needed = true): string[] {
		this.check(named);
		const tags = named.length > 0 ? named : this.inFolder(folder);
		if (tags.length === 0 && this.required && needed) {
			fail(
				"usage",
				`say which tag it has: \`--tag <name>\`${this.allowed === null ? "" : `, one of ${this.allowed.join(", ")}`}`,
				{ allowed: this.allowed ?? [] },
			);
		}
		return tags;
	}

	/** The allowed tag `folder` is named for, or inside a folder named for, if any. */
	private inFolder(folder: string): string[] {
		const found = folder
			.split("/")
			.find((part) => this.allowed?.includes(part));
		return found === undefined ? [] : [found];
	}
}
