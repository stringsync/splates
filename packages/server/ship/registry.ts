import type { Registry } from "webappwiz/ship";
import { Duration } from "webappwiz/time";

/** Exact public npm publications, with failures kept distinct from absence. */
export class ShipRegistry implements Pick<Registry, "published" | "deployed"> {
	constructor(private readonly http: RegistryHttp = { fetch }) {}

	/** The npm latest dist-tag, or undefined when no latest release exists. */
	async deployed(name: string): Promise<string | undefined> {
		const response = await this.http.fetch(
			`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`,
			{ signal: AbortSignal.timeout(Duration.secs(10).ms) },
		);
		if (response.status === 404) {
			return undefined;
		}
		if (!response.ok) {
			throw new Error(
				`npm could not read ${name}@latest: HTTP ${response.status}`,
			);
		}
		const value = (await response.json()) as {
			name?: unknown;
			version?: unknown;
		} | null;
		if (
			value?.name !== name ||
			typeof value.version !== "string" ||
			value.version.trim() === ""
		) {
			throw new Error(`npm returned unexpected evidence for ${name}@latest`);
		}
		return value.version;
	}

	async published(name: string, version: string): Promise<boolean> {
		const response = await this.http.fetch(
			`https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
			{ signal: AbortSignal.timeout(Duration.secs(10).ms) },
		);
		if (response.status === 404) {
			return false;
		}
		if (!response.ok) {
			throw new Error(
				`npm could not confirm ${name}@${version}: HTTP ${response.status}`,
			);
		}
		const value = (await response.json()) as {
			name?: unknown;
			version?: unknown;
		};
		if (value.name !== name || value.version !== version) {
			throw new Error(
				`npm returned unexpected evidence for ${name}@${version}`,
			);
		}
		return true;
	}
}

/** Read-only HTTP used to confirm public npm evidence. */
export interface RegistryHttp {
	fetch(url: string, init?: RequestInit): Promise<Response>;
}
