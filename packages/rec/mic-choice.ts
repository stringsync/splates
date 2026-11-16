import type { Fs } from "core/system";

/** The mic the person chose in the panel, by label, kept in a file so the next launch opens the same one. */
export class MicChoice {
	constructor(
		private readonly fs: Fs,
		private readonly file: string,
	) {}

	/** The remembered label, or undefined when none was saved or the file is unreadable. */
	async read(): Promise<string | undefined> {
		try {
			const saved: unknown = JSON.parse(await this.fs.read(this.file));
			const label = (saved as { label?: unknown } | null)?.label;
			return typeof label === "string" && label !== "" ? label : undefined;
		} catch {
			return undefined;
		}
	}

	async write(label: string): Promise<void> {
		await this.fs.write(this.file, JSON.stringify({ label }));
	}
}
