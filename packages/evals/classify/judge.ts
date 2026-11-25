import { type Judge, judgeFrom } from "@splates/server/auto-pick";
import { systemPs } from "@splates/server/config";
import { splatesHome } from "@splates/server/models";
import { openRepository } from "@splates/server/records";
import { Spend } from "@splates/server/spend";
import { FsStorage } from "@splates/server/storage";
import { MemoryLogger } from "core/log";
import { NodeFs } from "core/system";
import { PURPOSE } from "./run";

/**
 * The judge Auto pick asks in the project the working directory is in,
 * from its kept creds, each Jev call recorded in the machine's ledger as
 * `jev-latest evals`; null when no cred for a judge is kept. Keeps nothing
 * open after.
 */
export async function evalJudge(): Promise<Judge | null> {
	const fs = new NodeFs();
	const ps = systemPs();
	const records = await openRepository({ fs, ps, log: new MemoryLogger() });
	try {
		return await judgeFrom(records.creds.credentials, {
			spend: new Spend(new FsStorage(splatesHome(ps), fs)),
			attribution: {
				project: null,
				task: null,
				conversation: null,
				purpose: PURPOSE,
			},
		});
	} finally {
		records.dispose();
	}
}
