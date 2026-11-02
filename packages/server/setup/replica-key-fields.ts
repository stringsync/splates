import { REPLICA_ACCESS_KEY, REPLICA_SECRET_KEY } from "../replica";
import type { StepField } from "./fields";

/** The two Spaces keys the Replica area asks for, each pasted in its own step. */
export const REPLICA_KEY_FIELDS: readonly StepField[] = [
	{
		kind: "cred",
		name: REPLICA_ACCESS_KEY,
		label: "Spaces access key (DigitalOcean file storage)",
		help: "In DigitalOcean's **API** page, under **Spaces Keys**, **Generate New Key**, limited to the bucket; paste its key id.",
	},
	{
		kind: "cred",
		name: REPLICA_SECRET_KEY,
		label: "Spaces secret key",
		help: "The secret shown once beside that key.",
	},
];
