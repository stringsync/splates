import type { Storage } from "../storage";
import type { BatchResult, Invite, Stacked } from "./batch";

/** Confirmed companions of a merge gate, read without changing its coordination records. */
export class BatchGroups {
	constructor(private readonly storage: Storage) {}

	/** Running tasks sharing a stack, leader first; invitations and settled batches are left out. */
	async active(running: string[]): Promise<string[][]> {
		const records = this.storage.collection("merge-batch");
		const read = async <T>(name: string): Promise<T | null> => {
			const raw = await records.read(name);
			try {
				return raw === null ? null : (JSON.parse(raw) as T);
			} catch {
				return null;
			}
		};
		const groups = new Map<string, string[]>();
		for (const task of running) {
			const invite = await read<Invite>(`invite:${task}`);
			if (invite === null || !running.includes(invite.leader)) {
				continue;
			}
			const stacked = await read<Stacked>(`stacked:${task}`);
			const result = await read<BatchResult>(`result:${task}`);
			if (
				stacked?.head == null ||
				stacked.onto !== invite.onto ||
				result !== null
			) {
				continue;
			}
			const group = groups.get(invite.leader) ?? [invite.leader];
			group.push(task);
			groups.set(invite.leader, group);
		}
		return [...groups.values()];
	}
}
