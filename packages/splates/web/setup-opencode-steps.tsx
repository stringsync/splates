import type { JSX } from "react";
import { OpenCodeControls } from "./setup-opencode";
import { OpenCodeModelControls } from "./setup-opencode-models";
import { OpenCodeReadyControls } from "./setup-opencode-ready";
import type { StepBodies } from "./setup-steps";

/** The OpenCode journey's pages, each still its native controls under Next. */
export const OPENCODE_STEPS: StepBodies = {
	"opencode-install": () => <OpenCodeControls step="opencode-install" />,
	"opencode-connect": () => <OpenCodeControls step="opencode-connect" />,
	"opencode-models": () => <OpenCodeModelControls />,
	"opencode-ready": ({ feed, onOpen, journey }): JSX.Element => (
		<OpenCodeReadyControls
			feed={feed}
			onOpen={onOpen}
			onRepair={() => journey.goTo("opencode-install")}
		/>
	),
};
