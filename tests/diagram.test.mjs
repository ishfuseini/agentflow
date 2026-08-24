import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { createServer } from "vite";

const root = process.cwd();

const loadDiagramModule = async () => {
	const server = await createServer({
		root,
		appType: "custom",
		configFile: false,
		logLevel: "error",
		resolve: { alias: { $lib: resolve(root, "src/lib") } },
		server: { middlewareMode: true },
	});
	try {
		return await server.ssrLoadModule("/src/lib/diagram/render.ts");
	} finally {
		await server.close();
	}
};

/** Real diagram_data from arch_pattern_lookup for healthcare_patient_insights. */
const healthcareDiagram = {
	components: [
		{
			name: "EHR / EMR systems",
			type: "source",
			sublabel: "Redox FHIR feeds",
			zone: "bronze",
		},
		{
			name: "Databricks bronze",
			type: "lakehouse",
			sublabel: "Delta Live Tables raw PHI",
			zone: "bronze",
		},
		{
			name: "Databricks silver",
			type: "lakehouse",
			sublabel: "de-identified, conformed",
			zone: "silver",
		},
		{
			name: "Unity Catalog",
			type: "governance",
			sublabel: "RBAC + ABAC, lineage",
			zone: "governance",
		},
		{
			name: "Databricks gold",
			type: "lakehouse",
			sublabel: "patient cohorts & features",
			zone: "gold",
		},
		{
			name: "MLflow risk model",
			type: "ml",
			sublabel: "patient risk scoring",
			zone: "gold",
		},
	],
	connections: [
		{
			from: "EHR / EMR systems",
			to: "Databricks bronze",
			label: "FHIR streaming",
			style: "solid",
		},
		{
			from: "Databricks bronze",
			to: "Databricks silver",
			label: "de-identification",
			style: "solid",
		},
		{
			from: "Databricks silver",
			to: "Databricks gold",
			label: "cohort build",
			style: "solid",
		},
		{
			from: "Databricks gold",
			to: "MLflow risk model",
			label: "training & inference",
			style: "solid",
		},
		{
			from: "Unity Catalog",
			to: "Databricks gold",
			label: "policy enforcement",
			style: "dashed",
		},
	],
	boundaries: [
		{ label: "US region (BAA services)", type: "region" },
		{ label: "HIPAA compliance zone", type: "compliance" },
	],
};

const VIOLET = "#a78bfa";
const ROSE = "#fb7185";
const AMBER = "#fbbf24";
const SLATE = "#94a3b8";

test("maps MCP component types onto the semantic palette", async () => {
	const { paletteFor } = await loadDiagramModule();

	// Types named directly by the spec.
	assert.equal(paletteFor("database"), "database");
	assert.equal(paletteFor("security"), "security");
	assert.equal(paletteFor("frontend"), "frontend");
	assert.equal(paletteFor("backend"), "backend");
	// Types the MCP source pack actually emits.
	assert.equal(paletteFor("lakehouse"), "database");
	assert.equal(paletteFor("governance"), "security");
	assert.equal(paletteFor("ml"), "backend");
	assert.equal(paletteFor("source"), "external");
	assert.equal(paletteFor("warehouse"), "database");
	assert.equal(paletteFor("audit"), "security");
	assert.equal(paletteFor("control"), "security");
	// Unknown and missing types fall back to slate.
	assert.equal(paletteFor("something-new"), "external");
	assert.equal(paletteFor(undefined), "external");
});

test("renders components, connections, and boundaries from diagram_data", async () => {
	const { renderDiagramSvg } = await loadDiagramModule();
	const svg = renderDiagramSvg(healthcareDiagram);

	// Every component renders as a labelled rounded rect with its sublabel.
	// Text is XML-escaped on the way in, so compare against the escaped form.
	const escaped = (value) => value.replace(/&/g, "&amp;");
	for (const component of healthcareDiagram.components) {
		assert.ok(
			svg.includes(escaped(component.name)),
			`missing ${component.name}`,
		);
		assert.ok(
			svg.includes(escaped(component.sublabel)),
			`missing ${component.sublabel}`,
		);
	}
	assert.ok(svg.includes('rx="6"'), "components should be rounded rects");
	// Double-rect masking keeps arrows from bleeding through the fill.
	assert.ok(svg.includes('fill="#0f172a"'));

	// Dark theme + grid background + JetBrains-friendly monospace chrome.
	assert.ok(svg.includes('id="grid"'));
	assert.ok(svg.includes('fill="url(#grid)"'));

	// Connections render as labelled arrows.
	assert.ok(svg.includes('marker-end="url(#arrowhead)"'));
	assert.ok(svg.includes("FHIR streaming"));
	assert.ok(svg.includes('stroke-dasharray="5,5"'), "dashed flow");

	// Database components use violet, security/governance rose, sources slate.
	assert.ok(svg.includes(VIOLET), "lakehouse components should be violet");
	assert.ok(svg.includes(ROSE), "governance components should be rose");
	assert.ok(svg.includes(SLATE), "source components should be slate");

	// Region boundary is a large dashed amber box; compliance zone is rose.
	assert.ok(svg.includes('stroke-dasharray="8,4"'), "region boundary dash");
	assert.ok(svg.includes(AMBER));
	assert.ok(svg.includes("US region (BAA services)"));
	assert.ok(svg.includes("HIPAA compliance zone"));
});

test("security-styled connections render as dashed rose arrows", async () => {
	const { renderDiagramSvg } = await loadDiagramModule();
	const svg = renderDiagramSvg({
		components: [
			{ name: "Users", type: "external" },
			{ name: "SAML SSO", type: "security" },
		],
		connections: [
			{ from: "Users", to: "SAML SSO", label: "OAuth 2.0", style: "security" },
		],
		boundaries: [],
	});

	assert.ok(svg.includes("OAuth 2.0"));
	assert.ok(svg.includes('marker-end="url(#arrowhead-security)"'));
	assert.ok(svg.includes(`stroke="${ROSE}"`));
});

test("materialises connection endpoints missing from components", async () => {
	const { renderDiagramSvg } = await loadDiagramModule();
	const svg = renderDiagramSvg({
		components: [{ name: "BigQuery", type: "database" }],
		connections: [{ from: "Users", to: "BigQuery", label: "queries" }],
		boundaries: [],
	});

	// "Users" is only named by a connection, so it still needs a box to point at.
	assert.ok(svg.includes("Users"));
	assert.ok(svg.includes("BigQuery"));
});

test("renders a self-contained HTML document with no JavaScript", async () => {
	const { renderDiagramHtml } = await loadDiagramModule();
	const html = renderDiagramHtml({
		diagram: healthcareDiagram,
		brand: { companyName: "Northwind Health", logoUrl: "https://cdn/logo.png" },
		fallbackTitle: "healthcare patient insights",
	});

	assert.ok(html.startsWith("<!doctype html>"));
	assert.ok(html.includes("<style>"), "CSS must be inline");
	assert.ok(html.includes("<svg"), "SVG must be inline");
	assert.ok(!html.includes("<script"), "no JavaScript");
	// Google Fonts is the only permitted external reference.
	const externalRefs = html.match(/https?:\/\/[^"']+/g) ?? [];
	for (const ref of externalRefs) {
		assert.ok(
			ref.startsWith("https://fonts.googleapis.com") ||
				ref.startsWith("https://cdn/logo.png") ||
				ref.startsWith("http://www.w3.org/2000/svg"),
			`unexpected external reference: ${ref}`,
		);
	}
});

test("branded header shows the logo and company name", async () => {
	const { renderDiagramHtml } = await loadDiagramModule();
	const html = renderDiagramHtml({
		diagram: healthcareDiagram,
		brand: { companyName: "Northwind Health", logoUrl: "https://cdn/logo.png" },
		fallbackTitle: "healthcare patient insights",
	});

	assert.ok(html.includes('src="https://cdn/logo.png"'));
	assert.ok(html.includes("Northwind Health Architecture"));
});

test("falls back to the pattern name when brand context is unavailable", async () => {
	const { renderDiagramHtml } = await loadDiagramModule();
	const html = renderDiagramHtml({
		diagram: healthcareDiagram,
		brand: null,
		fallbackTitle: "healthcare patient insights",
	});

	assert.ok(html.includes("healthcare patient insights Architecture"));
	assert.ok(!html.includes("<img"), "no logo without brand context");
	// The diagram itself still renders.
	assert.ok(html.includes("Databricks gold"));
});

test("escapes text from the MCP so markup cannot be injected", async () => {
	const { renderDiagramHtml } = await loadDiagramModule();
	const html = renderDiagramHtml({
		diagram: {
			components: [{ name: '<script>alert("x")</script>', type: "database" }],
			connections: [],
			boundaries: [],
		},
		brand: null,
		fallbackTitle: "test",
	});

	assert.ok(!html.includes("<script"));
	assert.ok(html.includes("&lt;script&gt;"));
});

test("extracts diagram data and brand from the run's MCP tool calls", async () => {
	const { diagramSourceFromToolCalls } = await loadDiagramModule();
	const source = diagramSourceFromToolCalls([
		{
			tool: "arch_pattern_lookup",
			result: {
				pattern_id: "healthcare_patient_insights",
				confidence: 0.92,
				diagram_data: healthcareDiagram,
			},
		},
		{
			tool: "brand_context_lookup",
			result: {
				company_name: "Northwind Health",
				logo_url: "https://cdn/logo.png",
			},
		},
	]);

	assert.equal(source.unavailable, null);
	assert.equal(source.diagram.components.length, 6);
	assert.equal(source.diagram.connections.length, 5);
	assert.equal(source.diagram.boundaries.length, 2);
	assert.equal(source.brand.companyName, "Northwind Health");
});

test("reports a weak match when the pattern carries no diagram data", async () => {
	const { diagramSourceFromToolCalls } = await loadDiagramModule();
	const source = diagramSourceFromToolCalls([
		{
			tool: "arch_pattern_lookup",
			result: { pattern_id: "generic_enterprise_ai_poc", confidence: 0.3 },
		},
	]);

	assert.equal(source.diagram, null);
	assert.equal(source.unavailable, "weak-match");
	assert.equal(source.brand, null);
});

test("keeps the diagram when only brand context is unavailable", async () => {
	const { diagramSourceFromToolCalls } = await loadDiagramModule();
	const source = diagramSourceFromToolCalls([
		{
			tool: "arch_pattern_lookup",
			result: { confidence: 0.9, diagram_data: healthcareDiagram },
		},
		{ tool: "brand_context_lookup", result: { available: false } },
	]);

	assert.equal(source.brand, null);
	assert.equal(source.unavailable, null);
	assert.ok(source.diagram);
});
