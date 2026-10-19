import type { SetupMachine, SetupStep } from "./setup";

/** `step`'s fields as the page draws them. */
export async function fieldsOf(
	step: SetupStep,
	machine: SetupMachine,
): Promise<FieldProgress[]> {
	const fields: FieldProgress[] = [];
	// Fields that will not read leave the page asking nothing; Next then checks.
	for (const field of await fieldsIn(step, machine).catch(() => [])) {
		switch (field.kind) {
			case "cred": {
				const { optional: _, ...rest } = field;
				fields.push({
					...rest,
					help: field.help ?? null,
					saved: (await machine.device.get(field.name)) !== undefined,
				});
				break;
			}
			case "text":
				fields.push({
					...field,
					placeholder: field.placeholder ?? null,
					optional: field.optional ?? false,
				});
				break;
			case "yes-no":
				fields.push(field);
				break;
			case "choice": {
				const { options, ...rest } = field;
				// A list that will not read leaves the field empty, so the rest
				// of setup still reads; Next then says to pick one.
				const listed = await options(machine).catch(() => []);
				fields.push({ ...rest, options: [...listed] });
				break;
			}
		}
	}
	return fields;
}

/** What `step`'s page asks on this machine. */
export async function fieldsIn(
	step: SetupStep,
	machine: SetupMachine,
): Promise<readonly StepField[]> {
	const { fields } = step;
	return typeof fields === "function" ? fields(machine) : (fields ?? []);
}

/**
 * One thing a step's page asks. `name` keys its answer, and for a cred is
 * the cred's own name, as `OPENAI_API_KEY`, which Next saves for the device
 * before it submits, so a step's `submit` reads it from `machine.device`.
 */
export type StepField =
	| {
			kind: "cred";
			name: string;
			label: string;
			help?: string;
			/**
			 * May be left unpasted, as a key with another way to the same end;
			 * the step's check then says whether it is done.
			 */
			optional?: boolean;
	  }
	| {
			kind: "text";
			name: string;
			label: string;
			placeholder?: string;
			/** May be left empty, as a team name only some accounts need. */
			optional?: boolean;
	  }
	| { kind: "yes-no"; name: string; label: string }
	| {
			kind: "choice";
			name: string;
			label: string;
			/** What may be picked, read each time the page reads setup. */
			options(machine: SetupMachine): Promise<readonly StepOption[]>;
	  };

/** One choice a `choice` field lists. */
export interface StepOption {
	value: string;
	label: string;
}

/** A field as the page draws it: a choice's options listed, a cred saved or not. */
export type FieldProgress =
	| {
			kind: "cred";
			name: string;
			label: string;
			help: string | null;
			saved: boolean;
	  }
	| {
			kind: "text";
			name: string;
			label: string;
			placeholder: string | null;
			optional: boolean;
	  }
	| { kind: "yes-no"; name: string; label: string }
	| { kind: "choice"; name: string; label: string; options: StepOption[] };
