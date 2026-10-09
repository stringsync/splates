import type { Fs } from "webappwiz/system";
import { fail } from "./exit";

/**
 * The version of the records under `.git/arbor` this arbor reads and writes:
 * tasks, todos, lanes, the journal and conversations, as one. Bump it with
 * each change an older arbor would misread, and migrate older records
 * forward; arbor never writes an older format.
 */
export const FORMAT = 1;

/**
 * Checks the records at `arborDir` are in a format this arbor understands,
 * and stamps them with it when they have none: records from before formats
 * were stamped are version 1. A newer format is refused, since an older arbor
 * would misread or overwrite it.
 */
export async function checkFormat(fs: Fs, arborDir: string): Promise<void> {
	const path = `${arborDir}/format`;
	const raw = await fs.read(path).catch(() => null);
	if (raw === null) {
		const tmp = `${path}.${crypto.randomUUID()}.tmp`;
		await fs.write(tmp, `${FORMAT}\n`);
		await fs.rename(tmp, path);
		return;
	}
	const format = Number(raw.trim());
	if (!Number.isInteger(format) || format < 1) {
		fail("usage", `${path} names no format: '${raw.trim()}'`, { format: raw });
	}
	if (format > FORMAT) {
		fail(
			"outdated",
			[
				`this repository's arbor records are in format ${format}, written by a newer arbor; this one understands up to ${FORMAT}, so it leaves them alone.`,
				"Run `bunx @webappwiz/arbor@latest` instead.",
			].join("\n"),
			{ format, understood: FORMAT },
		);
	}
}
