import type { Fs } from "core/system";
import { EVENTS_FILE } from "./pointer";
import { detectSignals, MOMENTS_JSONL, renderSignals } from "./signals";

/** Detects signals in a session folder's events and logs, and writes them to its moments file. */
export async function writeSignals(
	fs: Fs,
	dir: string,
	startedAt: number,
): Promise<void> {
	const names = (await fs.readdir(`${dir}/logs`).catch(() => []))
		.filter((name) => name.endsWith(".log"))
		.sort();
	const logs = await Promise.all(
		names.map(async (name) => ({
			source: `logs/${name}`,
			text: await fs.read(`${dir}/logs/${name}`),
		})),
	);
	const signals = detectSignals(
		await fs.read(`${dir}/${EVENTS_FILE}`).catch(() => ""),
		logs,
		startedAt,
	);
	await fs.write(`${dir}/${MOMENTS_JSONL}`, renderSignals(signals));
}
