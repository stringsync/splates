/** A `Storage` that keeps nothing: every read finds nothing, and every write is dropped. */
export class NoopStorage implements Storage {
	readonly length = 0;

	[name: string]: unknown;

	clear(): void {}

	getItem(_key: string): string | null {
		return null;
	}

	key(_index: number): string | null {
		return null;
	}

	removeItem(_key: string): void {}

	setItem(_key: string, _value: string): void {}
}
