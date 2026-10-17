// Fast runs never import the legacy runner or its LLM grader.
import { fastCli } from "./probe-cli";

const args = process.argv.slice(2);
if (args[0] === "e2e") {
	process.argv.splice(2, 1);
	if (process.argv[2] !== "report" && process.argv[2] !== "run") {
		process.argv.splice(2, 0, "run");
	}
	await import("./e2e");
} else {
	await fastCli(args);
}
