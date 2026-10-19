import type { Fs } from "webappwiz/system";

/** The last todo the groomer saw, kept in a file past a restart. */
export class SeenGroomed {
	constructor(
		private readonly fs: Fs,
		private readonly path: string,
	) {}

	/** The id of the last todo seen, or null before any was. */
	async read(): Promise<number | null> {
		const raw = await this.fs.read(this.path).catch(() => null);
		if (raw === null) {
			return null;
		}
		const through = Number(raw.trim());
		return Number.isInteger(through) ? through : null;
	}

	async write(through: number): Promise<void> {
		await this.fs.write(this.path, `${through}\n`);
	}
}
