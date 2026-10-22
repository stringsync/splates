import type { Migration } from "./format";

/** The step that moves a project's records out of `.git/splates` into its database. */
export const TO_SQLITE: Migration = {
	does: "moves the records into the project's database",
	async run(splatesDir, _fs, into) {
		if (into === undefined) {
			throw new Error("no database to move the records into");
		}
		// The files stay for `Migration` to set aside once every step has
		// passed, so a step cut short just starts over.
		await into.import(splatesDir);
	},
};
