import type { Fs } from "webappwiz/system";
import { fail } from "../exit";

/**
 * The words a person dictates in every project, kept in one file under
 * their home rather than in any project's config, which is checked in.
 */
export class PersonalWords {
	constructor(
		/** `~/.splates/dictation.json`, or a test's own. */
		readonly path: string,
		private readonly deps: { fs: Fs },
	) {}

	/** Whether the person has saved a list, even an empty one. */
	saved(): Promise<boolean> {
		return this.deps.fs.exists(this.path);
	}

	/** The words as the file keeps them; none when there is no file. */
	async words(): Promise<string[]> {
		const raw = await this.deps.fs.read(this.path).catch(() => null);
		if (raw === null) {
			return [];
		}
		let json: unknown;
		try {
			json = JSON.parse(raw);
		} catch {
			fail("usage", `${this.path} is not JSON: fix or delete it`, {
				path: this.path,
			});
		}
		const words = (json as { words?: unknown } | null)?.words;
		if (
			!Array.isArray(words) ||
			!words.every((word) => typeof word === "string")
		) {
			fail(
				"usage",
				`${this.path} has no \`words\` list of strings: fix or delete it`,
				{ path: this.path },
			);
		}
		return words;
	}

	async save(words: readonly string[]): Promise<void> {
		await this.deps.fs.mkdir(this.path.slice(0, this.path.lastIndexOf("/")), {
			recursive: true,
		});
		// Through a temporary file, so a take never reads half of it.
		const tmp = `${this.path}.${crypto.randomUUID()}.tmp`;
		await this.deps.fs.write(tmp, `${JSON.stringify({ words }, null, "\t")}\n`);
		await this.deps.fs.rename(tmp, this.path);
	}

	/** Deletes the file; none there is fine. */
	async remove(): Promise<void> {
		await this.deps.fs.rm(this.path, { force: true });
	}
}

/** Where this machine keeps the person's words, under `home`, `~/.splates`. */
export function personalWordsPath(home: string): string {
	return `${home}/dictation.json`;
}

/** The words in a list typed as commas or lines, trimmed, empty ones dropped. */
export function parseWords(text: string): string[] {
	return text
		.split(/[,\n]/)
		.map((word) => word.trim())
		.filter((word) => word !== "");
}
