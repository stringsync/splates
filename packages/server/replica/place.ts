import { isAbsolute, resolve } from "node:path";
import type { Fs } from "webappwiz/system";
import type { Creds } from "../creds";
import { DirReplica } from "./dir";
import type { Replica } from "./replica";
import { type S3Place, S3Replica } from "./s3";

/**
 * Where a project's `splates.config.ts` sends its replica, by provider: a
 * bucket of any S3-compatible store, as
 * `{ provider: "s3", endpoint: "https://nyc3.digitaloceanspaces.com", bucket: "my-splates" }`,
 * or a folder, as `{ provider: "dir", path: "/Volumes/Backup/splates" }`.
 */
export type ReplicaPlace =
	| ({ provider: "s3" } & S3Place)
	| {
			provider: "dir";
			/** The folder, relative to the checkout's root unless absolute. */
			path: string;
	  };

/** The creds a bucket's key and secret are kept as, the project's then the device's. */
export const REPLICA_ACCESS_KEY = "REPLICA_ACCESS_KEY";
export const REPLICA_SECRET_KEY = "REPLICA_SECRET_KEY";

/** How the Creds page asks for each, once a replica needs them. */
const ASKED = {
	purpose:
		"the access key and secret of the bucket this project's `splates.config.ts` names as its `replica`, which splates copies the project's records into a few seconds behind every change",
	instructions:
		"In the store's control panel, make an access key limited to the bucket if it can be, and paste its key id as REPLICA_ACCESS_KEY and its secret as REPLICA_SECRET_KEY.",
};

/**
 * The replica `place` names, for the checkout at `root`. A bucket reads its
 * key and secret from `creds` at each request, asking for them on the Creds
 * page when they are not kept yet, so the replica starts once they are
 * filled without a restart.
 */
export function openReplica(
	place: ReplicaPlace,
	{
		root,
		fs,
		creds,
	}: { root: string; fs: Fs; creds: Pick<Creds, "credentials" | "request"> },
): Replica {
	if (place.provider === "dir") {
		return new DirReplica(
			isAbsolute(place.path) ? place.path : resolve(root, place.path),
			fs,
		);
	}
	// Asked once a run, so a retry does not move the request up the Creds page each time.
	let asked = false;
	return new S3Replica({
		...place,
		credentials: async () => {
			const accessKeyId = await creds.credentials.get(REPLICA_ACCESS_KEY);
			const secretAccessKey = await creds.credentials.get(REPLICA_SECRET_KEY);
			if (accessKeyId !== undefined && secretAccessKey !== undefined) {
				return { accessKeyId, secretAccessKey };
			}
			if (!asked) {
				asked = true;
				for (const name of [REPLICA_ACCESS_KEY, REPLICA_SECRET_KEY]) {
					await creds.request(name, { scope: "project", task: null, ...ASKED });
				}
			}
			throw new Error(
				`no ${REPLICA_ACCESS_KEY} and ${REPLICA_SECRET_KEY} yet: fill them on the Creds page`,
			);
		},
	});
}
