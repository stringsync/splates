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
});

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
