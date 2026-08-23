export interface Scenario {
	id: string;
	name: string;
	prompt: string;
}

/**
 * Pre-loaded demo scenarios. Each maps to a curated agentflow-mcp pattern with
 * high confidence and exercises the full pipeline including the HITL gate.
 * Prompt text mirrors openspec/changes/agentflow-demo/specs/agent-pipeline/spec.md
 * (the 4 demo scenarios from the agentflow-mcp overview).
 */
export const SCENARIOS = [
	{
		id: "agency",
		name: "Agency",
		prompt:
			"We're a top-5 media agency. We want to use AI to automate audience segmentation and campaign measurement across 3 client brands. We have BigQuery and Snowflake. SAML SSO is required, data must stay in EU, and we need cross-client governance controls.",
	},
	{
		id: "healthcare",
		name: "Healthcare",
		prompt:
			"A healthcare provider has 15 years of patient data on-prem. They want to modernize to Databricks on the cloud and add AI-powered patient insights. HIPAA compliance required, PHI data, US data residency.",
	},
	{
		id: "retail-lakehouse",
		name: "Retail Lakehouse",
		prompt:
			"A large retailer wants to build a lakehouse on Databricks and Snowflake for real-time personalization across e-commerce and in-store channels. They need sub-second recommendations and a unified customer view.",
	},
	{
		id: "fsi-governance",
		name: "FSI Governance",
		prompt:
			"A financial services firm wants to build an AI governance copilot on Snowflake. They handle PII and regulated financial data, require audit logs for all AI decisions, and need compliance with financial regulations.",
	},
] as const satisfies readonly Scenario[];

export type ScenarioId = (typeof SCENARIOS)[number]["id"];

export function getScenario(id: ScenarioId): Scenario {
	const scenario = SCENARIOS.find((entry) => entry.id === id);
	if (!scenario) {
		throw new Error(`Unknown scenario id: ${id}`);
	}
	return scenario;
}
