import { describe, expect, it } from "bun:test";
import { FakePs } from "webappwiz/system/testing";
import { BoxShell } from "./ssh";

function shell(ps: FakePs): BoxShell {
	return new BoxShell({
		ps,
		ipv4: "203.0.113.7",
		key: "/keys/box",
		knownHosts: "/keys/known_hosts",
	});
}

describe("the box's shell", () => {
	it("signs in as ubuntu and runs the script as root", async () => {
		const ps = new FakePs();
		await shell(ps).run("id -u");
		expect(ps.getCalls().at(-1)).toEndWith("ubuntu@203.0.113.7 sudo sh -s");
	});

	it("quotes a script that comes with stdin of its own", async () => {
		const ps = new FakePs();
		await shell(ps).run("cat > 'a b'", "text");
		expect(ps.getCalls().at(-1)).toContain(
			`ubuntu@203.0.113.7 sudo sh -c 'cat > '\\''a b'\\'''`,
		);
	});

	it("copies by way of ubuntu's home, then moves the file into place as root", async () => {
		const ps = new FakePs();
		await shell(ps).copy("/tmp/bundle.tgz", "/root/splates-move.tgz");
		const [scp, mv] = ps.getCalls().slice(-2);
		expect(scp).toEndWith(
			"/tmp/bundle.tgz ubuntu@203.0.113.7:copy-splates-move.tgz",
		);
		expect(mv).toContain("sudo sh -s");
	});

	it("opens a root login shell, or runs a command as root", () => {
		const ps = new FakePs();
		expect(shell(ps).login().slice(-4)).toEqual([
			"-t",
			"ubuntu@203.0.113.7",
			"sudo",
			"-i",
		]);
		expect(shell(ps).login(["journalctl", "-u", "splates"]).slice(-5)).toEqual([
			"ubuntu@203.0.113.7",
			"sudo",
			"journalctl",
			"-u",
			"splates",
		]);
	});
});
