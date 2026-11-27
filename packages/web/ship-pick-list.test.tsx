import { afterEach, describe, expect, test } from "bun:test";
import type { Listed } from "@splates/server/ship";
import { useState } from "react";
import { type Picks, ShipPickList } from "./ship-pick-list";
import { cleanup, fireEvent, render } from "./testing-library";

describe("ShipPickList follower", () => {
	afterEach(cleanup);

	test("follows its dependency and ticks it when a follower is ticked", () => {
		const seen: Picks[] = [];
		const view = render(<PickedList seen={seen} />);
		fireEvent.click(view.getByRole("checkbox", { name: "prod" }));
		expect(seen.at(-1)?.get("prod")).toEqual({ follow: true });
		expect(seen.at(-1)?.has("staging")).toBe(true);
		expect(view.getByText("follows staging")).toBeTruthy();
		expect(
			view.getByText(/v0\.1\.10 → 0\.1\.12, once staging deploys/),
		).toBeTruthy();
		const options = [
			...view
				.getByRole("combobox", { name: "prod's version" })
				.querySelectorAll("option"),
		].map((each) => each.textContent);
		expect(options).toEqual([
			"Follow staging",
			"0.1.11 · staging now",
			"0.1.10 · prod now",
		]);
	});

	test("spells out the change and its note when a version is picked", () => {
		const seen: Picks[] = [];
		const view = render(<PickedList seen={seen} />);
		fireEvent.click(view.getByRole("checkbox", { name: "prod" }));
		fireEvent.change(view.getByRole("combobox", { name: "prod's version" }), {
			target: { value: "0.1.11" },
		});
		expect(seen.at(-1)?.get("prod")).toEqual({ version: "0.1.11" });
		expect(view.getByText(/v0\.1\.10 → 0\.1\.11 · staging now/)).toBeTruthy();
		expect(view.queryByText("follows staging")).toBeNull();
	});

	test("switches the follower to the newest version when its dependency is unticked", () => {
		const seen: Picks[] = [];
		const view = render(<PickedList seen={seen} />);
		fireEvent.click(view.getByRole("checkbox", { name: "prod" }));
		fireEvent.click(view.getByRole("checkbox", { name: "staging" }));
		expect(seen.at(-1)?.get("prod")).toEqual({ version: "0.1.11" });
		expect(seen.at(-1)?.has("staging")).toBe(false);
	});

	test("ticks the full chain and shows the root version when ticking a follower of a follower", () => {
		const seen: Picks[] = [];
		const view = render(<ChainedPickedList seen={seen} />);
		fireEvent.click(view.getByRole("checkbox", { name: "player" }));
		const latest = seen.at(-1);
		expect(latest?.get("player")).toEqual({ follow: true });
		expect(latest?.get("prod")).toEqual({ follow: true });
		expect(latest?.get("staging")).toBe("patch");
		expect(view.getByText("follows prod")).toBeTruthy();
		expect(view.getByText("follows staging")).toBeTruthy();
		expect(
			view.getByText(/v0\.1\.10 → 0\.1\.12, once staging deploys/),
		).toBeTruthy();
		expect(
			view.getByText(/v0\.1\.9 → 0\.1\.12, once prod deploys/),
		).toBeTruthy();
	});

	test("re-ticks the full chain when choosing Follow on a chained follower", () => {
		const seen: Picks[] = [];
		const view = render(<ChainedPickedList seen={seen} />);
		fireEvent.click(view.getByRole("checkbox", { name: "player" }));
		fireEvent.click(view.getByRole("checkbox", { name: "prod" }));
		fireEvent.click(view.getByRole("checkbox", { name: "staging" }));
		expect(seen.at(-1)?.has("prod")).toBe(false);
		expect(seen.at(-1)?.has("staging")).toBe(false);
		expect(seen.at(-1)?.get("player")).toEqual({ version: "0.1.10" });

		fireEvent.change(view.getByRole("combobox", { name: "player's version" }), {
			target: { value: "follow:" },
		});
		const latest = seen.at(-1);
		expect(latest?.get("player")).toEqual({ follow: true });
		expect(latest?.get("prod")).toEqual({ follow: true });
		expect(latest?.get("staging")).toBe("patch");
	});

	test("handles unticking upstream targets cleanly in a 3-target follow chain", () => {
		const seen: Picks[] = [];
		const view = render(<ChainedPickedList seen={seen} />);
		fireEvent.click(view.getByRole("checkbox", { name: "player" }));

		// Unticking staging pins prod to its newest version while player keeps following prod.
		fireEvent.click(view.getByRole("checkbox", { name: "staging" }));
		expect(seen.at(-1)?.has("staging")).toBe(false);
		expect(seen.at(-1)?.get("prod")).toEqual({ version: "0.1.11" });
		expect(seen.at(-1)?.get("player")).toEqual({ follow: true });
		expect(
			view.getByText(/v0\.1\.9 → 0\.1\.11, once prod deploys/),
		).toBeTruthy();

		// Unticking prod pins player to its newest version.
		fireEvent.click(view.getByRole("checkbox", { name: "prod" }));
		expect(seen.at(-1)?.has("prod")).toBe(false);
		expect(seen.at(-1)?.get("player")).toEqual({ version: "0.1.10" });
	});

	test("does not tick the root when the middle follower is already pinned to an exact version", () => {
		const seen: Picks[] = [];
		const view = render(<ChainedPickedList seen={seen} />);
		fireEvent.click(view.getByRole("checkbox", { name: "prod" }));
		fireEvent.click(view.getByRole("checkbox", { name: "staging" }));
		expect(seen.at(-1)?.get("prod")).toEqual({ version: "0.1.11" });
		expect(seen.at(-1)?.has("staging")).toBe(false);

		fireEvent.click(view.getByRole("checkbox", { name: "player" }));
		expect(seen.at(-1)?.get("player")).toEqual({ follow: true });
		expect(seen.at(-1)?.get("prod")).toEqual({ version: "0.1.11" });
		expect(seen.at(-1)?.has("staging")).toBe(false);
	});

	test("guards against a cycle in follows", () => {
		const seen: Picks[] = [];
		const first: Listed = {
			command: "bin/s2s ship",
			plan: {
				name: "a",
				versioned: true,
				follows: "b",
				dependencies: ["b"],
				steps: [],
			},
		};
		const second: Listed = {
			command: "bin/s2s ship",
			plan: {
				name: "b",
				versioned: true,
				follows: "a",
				dependencies: ["a"],
				steps: [],
			},
		};
		function CyclicList() {
			const [picks, setPicks] = useState<Picks>(new Map());
			seen.push(picks);
			return (
				<ShipPickList
					targets={[first, second]}
					picks={picks}
					onPicks={setPicks}
				/>
			);
		}
		const view = render(<CyclicList />);
		fireEvent.click(view.getByRole("checkbox", { name: "a" }));
		expect(seen.at(-1)?.get("a")).toEqual({ follow: true });
		expect(seen.at(-1)?.get("b")).toEqual({ follow: true });
		expect(view.getByText(/once b deploys/)).toBeTruthy();
	});
});

const player: Listed = {
	command: "bin/s2s ship",
	plan: {
		name: "player",
		versioned: true,
		follows: "prod",
		dependencies: ["prod"],
		steps: [],
	},
};

function ChainedPickedList({ seen }: { seen: Picks[] }) {
	const [picks, setPicks] = useState<Picks>(new Map());
	seen.push(picks);
	return (
		<ShipPickList
			targets={[staging, prod, player]}
			current={{ prod: "0.1.10", player: "0.1.9" }}
			shippable={{
				...VERSIONS,
				player: [
					{ version: "0.1.10", note: "prod now" },
					{ version: "0.1.9", note: "player now" },
				],
			}}
			picks={picks}
			onPicks={setPicks}
		/>
	);
}

const staging: Listed = {
	command: "bin/s2s ship",
	plan: {
		name: "staging",
		versioned: true,
		bump: "patch",
		version: "0.1.12",
		dependencies: [],
		steps: [],
	},
};
const prod: Listed = {
	command: "bin/s2s ship",
	plan: {
		name: "prod",
		versioned: true,
		follows: "staging",
		dependencies: ["staging"],
		steps: [],
	},
};

const VERSIONS = {
	prod: [
		{ version: "0.1.11", note: "staging now" },
		{ version: "0.1.10", note: "prod now" },
	],
};

function PickedList({ seen }: { seen: Picks[] }) {
	const [picks, setPicks] = useState<Picks>(new Map());
	seen.push(picks);
	return (
		<ShipPickList
			targets={[staging, prod]}
			current={{ prod: "0.1.10" }}
			shippable={VERSIONS}
			picks={picks}
			onPicks={setPicks}
		/>
	);
}
