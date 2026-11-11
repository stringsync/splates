import { MemoryStorage } from "../storage/testing";
import type { Action, Event, Facts, FactsOf } from "./events";
import { Journal } from "./journal";

/** A `Journal` that remembers nothing: it runs what it is given and logs nothing. */
export class NoopJournal extends Journal {
	constructor() {
		super(new MemoryStorage(), 0);
	}

	override in(): Journal {
		return this;
	}

	override async record<A extends Action, T>(
		_action: A,
		_task: string | null,
		run: () => Promise<T>,
		..._facts: FactsOf<A, T>
	): Promise<T> {
		return run();
	}

	override async waiting<A extends "wait" | "task wait" | "creds wait", T>(
		_action: A,
		_task: string | null,
		_facts: Omit<Facts[A], "began">,
		run: () => Promise<T>,
	): Promise<T> {
		return run();
	}

	override async begin(): Promise<string> {
		return "";
	}

	override async tail(_count: number): Promise<Event[]> {
		return [];
	}

	override async all(): Promise<Event[]> {
		return [];
	}

	override async recent(): Promise<Event[]> {
		return [];
	}
}
