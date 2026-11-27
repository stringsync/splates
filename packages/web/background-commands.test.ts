import { describe, expect, it } from "bun:test";
import { hasOwnCard, isWaitCommand } from "./background-commands";

describe("background command classification", () => {
	it("identifies splates wait commands", () => {
		expect(isWaitCommand("splates wait alpha")).toBe(true);
		expect(isWaitCommand("splates task wait 42")).toBe(true);
		expect(isWaitCommand("splates todo wait 42")).toBe(true);
		expect(isWaitCommand("splates creds wait API_KEY")).toBe(true);
		expect(
			isWaitCommand("cd /tree && bunx @stringsync/splates wait alpha"),
		).toBe(true);
		expect(isWaitCommand("splates merge --message 'Add feature'")).toBe(false);
		expect(isWaitCommand("bun test")).toBe(false);
		expect(isWaitCommand(null)).toBe(false);
	});

	it("identifies commands that already have their own thread card", () => {
		expect(hasOwnCard("splates merge --message 'Land fix'")).toBe(true);
		expect(
			hasOwnCard(
				'SPLATES_ROOT="$(splates path)" splates/bin/splates merge --message "Land"',
			),
		).toBe(true);
		expect(hasOwnCard("cd /worktree && nohup splates merge &")).toBe(true);
		expect(hasOwnCard("bunx @stringsync/splates merge")).toBe(true);
		expect(hasOwnCard("bin/evals run --scenario foo")).toBe(true);
		expect(hasOwnCard("timeout 300 ./bin/evals run splates")).toBe(true);
		expect(
			hasOwnCard(
				'splates signal wait mdom.released --timeout 1h --description "Wait for npm release."',
			),
		).toBe(true);
		expect(
			hasOwnCard(
				'splates signal poll aws.ready --interval 1m --timeout 1h --description "Poll stack." -- ./check',
			),
		).toBe(true);
		expect(hasOwnCard("splates wait alpha")).toBe(true);
	});

	it("leaves ordinary commands and other splates commands as generic background commands", () => {
		expect(hasOwnCard("bun dev")).toBe(false);
		expect(hasOwnCard("bun test")).toBe(false);
		expect(hasOwnCard("splates list")).toBe(false);
		expect(hasOwnCard("splates signal fire mdom.released")).toBe(false);
		expect(hasOwnCard('echo "splates merge"')).toBe(false);
		expect(hasOwnCard(null)).toBe(false);
	});
});
