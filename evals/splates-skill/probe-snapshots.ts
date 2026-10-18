import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { instructionFiles, type SkillChange } from "./probe-change";
import { hash } from "./probe-record";

/** Freeze admitted instruction bytes so later edits cannot change an experiment. */
export async function freezeSnapshots(
	change: SkillChange,
	directory: string,
	unchanged = false,
) {
	if (
		unchanged &&
		(change.files.length || change.beforeHash !== change.afterHash)
	) {
		throw new Error(
			"Unchanged baseline requires identical instruction snapshots",
		);
	}
	if (
		!unchanged &&
		(!change.files.length || change.beforeHash === change.afterHash)
	) {
		throw new Error("Paired execution requires a genuine instruction diff");
	}
	const snapshots = [];
	const roles = unchanged
		? (["current"] as const)
		: (["baseline", "candidate"] as const);
	for (const role of roles) {
		const expected = role === "baseline" ? change.beforeHash : change.afterHash;
		const files = change.snapshots[role === "current" ? "candidate" : role];
		if (hash(files) !== expected) {
			throw new Error("Instruction snapshot identity changed");
		}
		const source = join(directory, role);
		await mkdir(source);
		for (const [name, bytes] of Object.entries(files)) {
			if (name.startsWith("/") || name.split("/").includes("..")) {
				throw new Error("Unsafe instruction path");
			}
			const path = join(source, name);
			await mkdir(dirname(path), { recursive: true });
			await writeFile(path, Buffer.from(bytes, "base64"), {
				flag: "wx",
				mode: 0o444,
			});
		}
		await verifySnapshot(source, expected);
		snapshots.push({ role, hash: expected, source });
	}
	return snapshots;
}

/** Reject a snapshot whose instruction bytes no longer match the admitted hash. */
export async function verifySnapshot(
	source: string,
	expected: string,
): Promise<void> {
	if (hash(await instructionFiles(source)) !== expected) {
		throw new Error(
			"Selected instruction snapshot changed; experiment stopped",
		);
	}
}
