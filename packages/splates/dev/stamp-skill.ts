// Run by the new ship's `prepare`, from the mirror's root: stamps the skill's
// frontmatter `version:` at the release's version, `SHIP_VERSION`, so a
// project's copy, installed from the release's tag, says which release it is.

import { stampSkill } from "./stamp";

const version = process.env.SHIP_VERSION;
if (!version) {
	throw new Error("SHIP_VERSION is not set: the ship's prepare sets it");
}
const path = "skills/splates/SKILL.md";
await Bun.write(path, stampSkill(await Bun.file(path).text(), version));
console.log(`${path} stamped ${version}`);
