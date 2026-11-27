import "./testing-dom";
import { afterEach, expect, it } from "bun:test";
import type { AutopickAgent } from "@splates/server/autopick";
import { PickChips, type PickList } from "./autopick-pick-chips";
import { act, cleanup, fireEvent, render, within } from "./testing";

afterEach(cleanup);

it("groups the menu under each agent's maker, with speed, cost and what is added", async () => {
	const list = listOf([["claude", "sonnet"]]);
	const view = render(
		<PickChips list={list} picks={[{ agent: "claude", model: "sonnet" }]} />,
	);
	await act(async () =>
		fireEvent.click(
			view.getByRole("button", { name: "Add an agent to eval agents" }),
		),
	);
	const menu = await view.findByRole("menu");

	expect(within(menu).getByText("· Anthropic")).toBeTruthy();
	expect(within(menu).getByText("· Google")).toBeTruthy();
	const flash = within(menu).getByRole("menuitem", {
		name: /Gemini 3\.8 Flash/,
	});
	expect(flash.textContent).toContain("fast");
	expect(flash.textContent).toContain("low cost");
	const sonnet = within(menu).getByRole("menuitem", { name: /Sonnet/ });
	expect(sonnet.textContent).toContain("Added");
	expect(sonnet.getAttribute("aria-disabled")).toBe("true");

	await act(async () => fireEvent.click(flash));
	expect(list.adds).toEqual([["antigravity", "gemini-3.8-flash"]]);
});

it("marks a chip with its model's maker", () => {
	const view = render(
		<PickChips
			list={listOf([])}
			picks={[{ agent: "antigravity", model: "gemini-3.8-flash" }]}
		/>,
	);

	const chip = view.getByRole("listitem", { name: "eval agents pick 1" });
	expect(within(chip).getByRole("img", { name: "Google" })).toBeTruthy();
});

const AGENTS: AutopickAgent[] = [
	{
		id: "claude",
		name: "Claude",
		models: [
			{
				id: "sonnet",
				name: "Sonnet",
				provider: "anthropic",
				speed: "medium",
				costRank: 2,
			},
			{ id: "haiku", name: "Haiku", provider: "anthropic" },
		],
		efforts: null,
	},
	{
		id: "antigravity",
		name: "Antigravity",
		models: [
			{
				id: "gemini-3.8-flash",
				name: "Gemini 3.8 Flash",
				provider: "google",
				speed: "fast",
				costRank: 1,
			},
		],
		efforts: null,
	},
	{ id: "fake", name: "Fake", models: [], efforts: null },
];

function listOf(added: [string, string][]): PickList & { adds: unknown[] } {
	const adds: unknown[] = [];
	return {
		label: "eval agents",
		agents: AGENTS,
		note: null,
		least: 0,
		adds,
		efforts: () => [],
		has: (agent, model) =>
			added.some(
				([eachAgent, eachModel]) => eachAgent === agent && eachModel === model,
			),
		add: (agent, model) => void adds.push([agent, model]),
		remove: () => {},
		move: () => {},
		setModel: () => {},
		setEffort: () => {},
	};
}
