export { FakeS3 } from "./fake-s3";

import { keyIn } from "../storage";
import { byKey, md5, type Replica, type ReplicaObject } from "./replica";

/** A replica held in this process, for tests: what is kept can be read back with `peek`. */
export class FakeReplica implements Replica {
	readonly name = "fake";
	/** What is kept, by key. */
	readonly objects = new Map<string, Uint8Array>();
	/** Each put, delete and list, in order, as `put <key>`. */
	readonly calls: string[] = [];
	/** Set to make every call throw it, as an unreachable store would. */
	failing: Error | null = null;

	async put(key: string, bytes: Uint8Array): Promise<void> {
		this.check("put", key);
		this.objects.set(keyIn("", key), bytes.slice());
	}

	async get(key: string): Promise<Uint8Array | null> {
		this.check("get", key);
		return this.objects.get(keyIn("", key))?.slice() ?? null;
	}

	async list(key: string): Promise<ReplicaObject[]> {
		this.check("list", key);
		const prefix = key === "" ? "" : `${keyIn("", key)}/`;
		return [...this.objects.entries()]
			.filter(([at]) => at.startsWith(prefix))
			.map(([at, bytes]) => ({ key: at, size: bytes.length, md5: md5(bytes) }))
			.sort(byKey);
	}

	async delete(key: string): Promise<void> {
		this.check("delete", key);
		this.objects.delete(keyIn("", key));
	}

	/** What is kept at `key` as text, or null. */
	peek(key: string): string | null {
		const bytes = this.objects.get(key);
		return bytes === undefined ? null : new TextDecoder().decode(bytes);
	}

	private check(call: string, key: string): void {
		if (this.failing !== null) {
			throw this.failing;
		}
		if (call !== "get") {
			this.calls.push(`${call} ${key}`);
		}
	}
}
