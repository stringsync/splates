import type { SecretStore } from "webappwiz/creds";

/** A store read as keeping nothing when it cannot be reached, so the others still answer. */
export class Unreachable implements SecretStore {
	constructor(private readonly inner: SecretStore) {}

	get label(): string {
		return this.inner.label;
	}
	get(name: string): Promise<string | undefined> {
		return this.inner.get(name).catch(() => undefined);
	}
	set(name: string, value: string): Promise<void> {
		return this.inner.set(name, value);
	}
	delete(name: string): Promise<boolean> {
		return this.inner.delete(name);
	}
	names(): Promise<string[]> {
		return this.inner.names().catch(() => []);
	}
}
