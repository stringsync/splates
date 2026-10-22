import { dirname } from "node:path";
import type { SecretStore } from "webappwiz/creds";
import type { Fs } from "webappwiz/system";

/**
 * Secrets kept in a file only its user may read (`0600`), as `NAME=value`
 * lines, for a machine whose system store is locked or missing when it
 * boots, as WSL's is with no one signed in or a headless Linux's with no
 * secret service: a worker's key and Access token with `--key-file`, a
 * server's creds with `SPLATES_SECRET_STORE=file`.
 */
export class KeyFileStore implements SecretStore {
	readonly label: string;

	constructor(
		readonly path: string,
		private readonly fs: Fs,
	) {
		this.label = path;
	}

	async get(name: string): Promise<string | undefined> {
		return (await this.read()).get(name);
	}

	async set(name: string, value: string): Promise<void> {
		if (/[\r\n]/.test(value)) {
			throw new Error(`${name} spans lines, which ${this.path} cannot keep`);
		}
		const values = await this.read();
		values.set(name, value);
		await this.write(values);
	}

	async delete(name: string): Promise<boolean> {
		const values = await this.read();
		if (!values.delete(name)) {
			return false;
		}
		await this.write(values);
		return true;
	}

	async names(): Promise<string[]> {
		return [...(await this.read()).keys()].sort();
	}

	private async read(): Promise<Map<string, string>> {
		const text = await this.fs.read(this.path).catch(() => "");
		const values = new Map<string, string>();
		for (const line of text.split("\n")) {
			const at = line.indexOf("=");
			if (at > 0) {
				values.set(line.slice(0, at), line.slice(at + 1));
			}
		}
		return values;
	}

	private async write(values: Map<string, string>): Promise<void> {
		const text = [...values]
			.map(([name, value]) => `${name}=${value}\n`)
			.join("");
		// Made empty and closed to others before the key goes in.
		if (!(await this.fs.exists(this.path))) {
			await this.fs.mkdir(dirname(this.path));
			await this.fs.write(this.path, "");
		}
		await this.fs.chmod(this.path, 0o600);
		await this.fs.write(this.path, text);
	}
}
