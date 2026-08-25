/**
 * Architecture diagram renderer (architecture-diagram spec).
 *
 * Turns the `diagram_data` returned by agentflow-mcp's `arch_diagram` tool
 * (fetched on demand via /api/diagram, after risk evaluation) into a
 * self-contained HTML document with inline CSS and SVG, following the
 * design system in docs/agent/architecture-diagram/SKILL.md: slate-950 grid
 * background, JetBrains Mono, rounded component rects, semantic component
 * colors, dashed amber region boundaries.
 *
 * Pure and dependency-free so it runs on the server (pipeline) and in the
 * browser (Results tab) alike, and so the output opens standalone in a browser.
 */

/** A box in the diagram. `type` comes from the MCP source pack, not a fixed enum. */
export interface DiagramComponent {
	name: string;
	type?: string;
	sublabel?: string;
	zone?: string;
}

export interface DiagramConnection {
	from: string;
	to: string;
	label?: string;
	/** "solid" (default), "dashed", or "security" (dashed + rose) */
	style?: string;
}

export interface DiagramBoundary {
	label: string;
	/** "region" (amber) or a security/compliance boundary (rose) */
	type?: string;
}

export interface DiagramData {
	components: DiagramComponent[];
	connections: DiagramConnection[];
	boundaries: DiagramBoundary[];
}

/** Header brand context from `brand_context_lookup`; null when unavailable. */
export interface BrandContext {
	companyName?: string;
	logoUrl?: string;
}

export interface RenderDiagramOptions {
	diagram: DiagramData;
	/** null when brand_context_lookup was unavailable or never called */
	brand: BrandContext | null;
	/** Header fallback when there is no brand context */
	fallbackTitle: string;
	subtitle?: string;
}

/** Semantic palette from the architecture-diagram skill. */
const PALETTE = {
	frontend: { fill: "rgba(8, 51, 68, 0.4)", stroke: "#22d3ee" },
	backend: { fill: "rgba(6, 78, 59, 0.4)", stroke: "#34d399" },
	database: { fill: "rgba(76, 29, 149, 0.4)", stroke: "#a78bfa" },
	cloud: { fill: "rgba(120, 53, 15, 0.3)", stroke: "#fbbf24" },
	security: { fill: "rgba(136, 19, 55, 0.4)", stroke: "#fb7185" },
	bus: { fill: "rgba(251, 146, 60, 0.3)", stroke: "#fb923c" },
	external: { fill: "rgba(30, 41, 59, 0.5)", stroke: "#94a3b8" },
} as const;

export type PaletteKey = keyof typeof PALETTE;

const PALETTE_LABELS: Record<PaletteKey, string> = {
	frontend: "Frontend",
	backend: "Backend / ML",
	database: "Data platform",
	cloud: "Cloud / infra",
	security: "Security / governance",
	bus: "Message bus",
	external: "External system",
};

/**
 * Component `type` values arrive from the MCP source pack's own vocabulary
 * ("lakehouse", "governance", "ml", "source"), not from the skill's palette
 * names, so each is mapped onto a palette category. Unknown types fall back to
 * `external` (slate), which is also the right answer for third-party systems.
 */
const TYPE_TO_PALETTE: Record<string, PaletteKey> = {
	frontend: "frontend",
	ui: "frontend",
	app: "frontend",
	client: "frontend",
	dashboard: "frontend",
	bi: "frontend",
	backend: "backend",
	service: "backend",
	api: "backend",
	compute: "backend",
	ml: "backend",
	model: "backend",
	analytics: "backend",
	copilot: "backend",
	agent: "backend",
	etl: "backend",
	pipeline: "backend",
	database: "database",
	db: "database",
	warehouse: "database",
	lakehouse: "database",
	lake: "database",
	storage: "database",
	datastore: "database",
	vector: "database",
	feature_store: "database",
	cloud: "cloud",
	infra: "cloud",
	infrastructure: "cloud",
	platform: "cloud",
	security: "security",
	governance: "security",
	identity: "security",
	iam: "security",
	sso: "security",
	policy: "security",
	compliance: "security",
	catalog: "security",
	audit: "security",
	control: "security",
	review: "security",
	gate: "security",
	guardrail: "security",
	bus: "bus",
	queue: "bus",
	stream: "bus",
	streaming: "bus",
	messaging: "bus",
	events: "bus",
	external: "external",
	source: "external",
	saas: "external",
	partner: "external",
};

const BOX_WIDTH = 190;
const BOX_HEIGHT = 62;
const GAP_X = 44;
const GAP_Y = 78;
const BOUNDARY_PAD = 26;
const BOUNDARY_LABEL_SPACE = 18;
const CANVAS_PAD = 32;
const LEGEND_GAP = 20;
const LEGEND_ROW_HEIGHT = 18;
const LEGEND_SWATCH = 10;
const CHAR_WIDTH = 6.2;
const LABEL_PAD = 5;
const LABEL_HEIGHT = 14;
/** Fractions along a connection to try when placing its label. */
const LABEL_POSITIONS = [0.5, 0.32, 0.68, 0.2, 0.8];

interface PlacedComponent extends DiagramComponent {
	palette: PaletteKey;
	x: number;
	y: number;
}

/** Maps a component's MCP `type` onto a semantic palette category. */
export function paletteFor(type: string | undefined): PaletteKey {
	if (!type) {
		return "external";
	}
	const key = type.toLowerCase().trim();
	return TYPE_TO_PALETTE[key] ?? "external";
}

function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/**
 * Assigns each component a layer from the connection graph (longest path from
 * a root), so the diagram reads as a flow. `diagram_data` carries no
 * coordinates, so layout is derived here rather than supplied by the MCP.
 */
function assignLayers(
	names: string[],
	connections: DiagramConnection[],
): Map<string, number> {
	const layers = new Map<string, number>(names.map((name) => [name, 0]));
	const edges = connections.filter(
		(edge) =>
			edge.from !== edge.to && layers.has(edge.from) && layers.has(edge.to),
	);

	// Relax edges |V| times: enough for any acyclic graph, and bounded so a
	// cycle in the source data settles instead of looping forever.
	for (const _pass of names) {
		let changed = false;
		for (const edge of edges) {
			const next = (layers.get(edge.from) ?? 0) + 1;
			if (next > (layers.get(edge.to) ?? 0)) {
				layers.set(edge.to, next);
				changed = true;
			}
		}
		if (!changed) {
			break;
		}
	}
	return layers;
}

/**
 * Places components in centered rows, one row per layer. Any connection
 * endpoint missing from `components` is materialised as an external box so no
 * arrow dangles.
 */
function layout(diagram: DiagramData): {
	placed: PlacedComponent[];
	width: number;
	height: number;
} {
	const components: DiagramComponent[] = [...diagram.components];
	const known = new Set(components.map((component) => component.name));
	for (const connection of diagram.connections) {
		for (const endpoint of [connection.from, connection.to]) {
			if (!known.has(endpoint)) {
				known.add(endpoint);
				components.push({ name: endpoint, type: "external" });
			}
		}
	}

	const layers = assignLayers(
		components.map((component) => component.name),
		diagram.connections,
	);
	const rows = new Map<number, DiagramComponent[]>();
	for (const component of components) {
		const layer = layers.get(component.name) ?? 0;
		const row = rows.get(layer);
		if (row) {
			row.push(component);
		} else {
			rows.set(layer, [component]);
		}
	}

	const orderedLayers = [...rows.keys()].sort((a, b) => a - b);
	const widest = Math.max(
		...orderedLayers.map((layer) => rows.get(layer)?.length ?? 0),
	);
	const contentWidth = widest * BOX_WIDTH + (widest - 1) * GAP_X;

	const placed: PlacedComponent[] = [];
	orderedLayers.forEach((layer, rowIndex) => {
		const row = rows.get(layer) ?? [];
		const rowWidth = row.length * BOX_WIDTH + (row.length - 1) * GAP_X;
		const offsetX = (contentWidth - rowWidth) / 2;
		row.forEach((component, columnIndex) => {
			placed.push({
				...component,
				palette: paletteFor(component.type),
				x: offsetX + columnIndex * (BOX_WIDTH + GAP_X),
				y: rowIndex * (BOX_HEIGHT + GAP_Y),
			});
		});
	});

	const contentHeight =
		orderedLayers.length * BOX_HEIGHT + (orderedLayers.length - 1) * GAP_Y;
	return { placed, width: contentWidth, height: contentHeight };
}

function boundaryStyle(type: string | undefined): {
	stroke: string;
	dash: string;
	radius: number;
} {
	// Regions get the large amber dash; security and compliance zones the
	// tighter rose dash, per the skill's boundary rules.
	if (!type || type.toLowerCase() === "region") {
		return { stroke: "#fbbf24", dash: "8,4", radius: 12 };
	}
	return { stroke: "#fb7185", dash: "4,4", radius: 8 };
}

function renderComponent(component: PlacedComponent): string {
	const { fill, stroke } = PALETTE[component.palette];
	const centerX = component.x + BOX_WIDTH / 2;
	const nameY = component.sublabel
		? component.y + BOX_HEIGHT / 2 - 2
		: component.y + BOX_HEIGHT / 2 + 4;
	const sublabel = component.sublabel
		? `<text x="${centerX}" y="${component.y + BOX_HEIGHT / 2 + 14}" fill="#94a3b8" font-size="9" text-anchor="middle">${escapeXml(component.sublabel)}</text>`
		: "";
	const zone = component.zone
		? `<text x="${component.x + 8}" y="${component.y + 13}" fill="#64748b" font-size="7" letter-spacing="0.08em">${escapeXml(component.zone.toUpperCase())}</text>`
		: "";

	// Double-rect masking: an opaque base keeps arrows from showing through the
	// semi-transparent styled rect drawn on top of it.
	return `<g>
    <rect x="${component.x}" y="${component.y}" width="${BOX_WIDTH}" height="${BOX_HEIGHT}" rx="6" fill="#0f172a" />
    <rect x="${component.x}" y="${component.y}" width="${BOX_WIDTH}" height="${BOX_HEIGHT}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="1.5" />
    ${zone}
    <text x="${centerX}" y="${nameY}" fill="#e2e8f0" font-size="12" font-weight="500" text-anchor="middle">${escapeXml(component.name)}</text>
    ${sublabel}
  </g>`;
}

/** Clips a center-to-center line to the source and target box edges. */
function edgePoint(
	from: { x: number; y: number },
	to: { x: number; y: number },
): { x: number; y: number } {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	if (dx === 0 && dy === 0) {
		return from;
	}
	const halfWidth = BOX_WIDTH / 2;
	const halfHeight = BOX_HEIGHT / 2;
	const scaleX = dx === 0 ? Number.POSITIVE_INFINITY : halfWidth / Math.abs(dx);
	const scaleY =
		dy === 0 ? Number.POSITIVE_INFINITY : halfHeight / Math.abs(dy);
	const scale = Math.min(scaleX, scaleY);
	return { x: from.x + dx * scale, y: from.y + dy * scale };
}

/** An area a connection label must not land on: another label, or a component. */
interface LabelBox {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * Picks a point along the line for the connection label, stepping away from the
 * midpoint when another label already occupies it — crossing edges otherwise
 * stack their labels on top of each other.
 */
function placeLabel(
	start: { x: number; y: number },
	end: { x: number; y: number },
	width: number,
	placed: LabelBox[],
): { x: number; y: number } {
	const overlaps = (candidate: { x: number; y: number }) =>
		placed.some(
			(box) =>
				Math.abs(box.y - candidate.y) < (box.height + LABEL_HEIGHT) / 2 &&
				Math.abs(box.x - candidate.x) < (box.width + width) / 2,
		);

	for (const t of LABEL_POSITIONS) {
		const candidate = {
			x: start.x + (end.x - start.x) * t,
			y: start.y + (end.y - start.y) * t,
		};
		if (!overlaps(candidate)) {
			placed.push({ ...candidate, width, height: LABEL_HEIGHT });
			return candidate;
		}
	}
	const fallback = {
		x: start.x + (end.x - start.x) / 2,
		y: start.y + (end.y - start.y) / 2 - LABEL_HEIGHT,
	};
	placed.push({ ...fallback, width, height: LABEL_HEIGHT });
	return fallback;
}

/**
 * Renders a connection as a line and (separately) its label. Lines are drawn
 * early so they sit behind the component boxes, per the skill's z-order rule;
 * labels are emitted after the boxes so they stay readable where an edge
 * passes underneath one.
 */
function renderConnection(
	connection: DiagramConnection,
	centers: Map<string, { x: number; y: number }>,
	placedLabels: LabelBox[],
): { line: string; label: string } {
	const fromCenter = centers.get(connection.from);
	const toCenter = centers.get(connection.to);
	if (!(fromCenter && toCenter)) {
		return { line: "", label: "" };
	}

	const style = (connection.style ?? "solid").toLowerCase();
	const isSecurity = style === "security";
	const isDashed = isSecurity || style === "dashed";
	const stroke = isSecurity ? "#fb7185" : "#64748b";
	const marker = isSecurity ? "arrowhead-security" : "arrowhead";
	const start = edgePoint(fromCenter, toCenter);
	const end = edgePoint(toCenter, fromCenter);
	const dash = isDashed ? ' stroke-dasharray="5,5"' : "";

	const line = `<line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" stroke="${stroke}" stroke-width="1.5"${dash} marker-end="url(#${marker})" />`;

	if (!connection.label) {
		return { line, label: "" };
	}
	const width = connection.label.length * CHAR_WIDTH + LABEL_PAD * 2;
	const at = placeLabel(start, end, width, placedLabels);
	const label = `<g>
    <rect x="${at.x - width / 2}" y="${at.y - 8}" width="${width}" height="${LABEL_HEIGHT}" rx="3" fill="#020617" opacity="0.9" />
    <text x="${at.x}" y="${at.y + 2}" fill="#94a3b8" font-size="8" text-anchor="middle">${escapeXml(connection.label)}</text>
  </g>`;
	return { line, label };
}

function renderBoundaries(
	boundaries: DiagramBoundary[],
	content: { width: number; height: number },
): { markup: string; bottom: number } {
	let markup = "";
	let bottom = content.height;
	boundaries.forEach((boundary, index) => {
		// No membership data in `diagram_data`, so each boundary wraps the whole
		// diagram, nested outward in declaration order.
		// ponytail: nest-all boundaries; switch to per-boundary member lists if
		// the MCP source pack ever emits component membership.
		const pad = BOUNDARY_PAD * (index + 1);
		const { stroke, dash, radius } = boundaryStyle(boundary.type);
		const x = -pad;
		const y = -pad - BOUNDARY_LABEL_SPACE * index;
		const width = content.width + pad * 2;
		const height = content.height + pad * 2 + BOUNDARY_LABEL_SPACE * index;
		bottom = Math.max(bottom, y + height);
		markup += `<g>
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-dasharray="${dash}" />
    <rect x="${x + 10}" y="${y - 7}" width="${boundary.label.length * CHAR_WIDTH + LABEL_PAD * 2}" height="14" rx="3" fill="#020617" />
    <text x="${x + 10 + LABEL_PAD}" y="${y + 3}" fill="${stroke}" font-size="8" letter-spacing="0.05em">${escapeXml(boundary.label)}</text>
  </g>`;
	});
	return { markup, bottom };
}

function renderLegend(used: PaletteKey[], top: number, width: number): string {
	const columns = Math.max(1, Math.floor(width / 200));
	const rows = used
		.map((key, index) => {
			const column = index % columns;
			const row = Math.floor(index / columns);
			const x = column * 200;
			const y = top + row * LEGEND_ROW_HEIGHT;
			const { fill, stroke } = PALETTE[key];
			return `<rect x="${x}" y="${y}" width="${LEGEND_SWATCH}" height="${LEGEND_SWATCH}" rx="2" fill="${fill}" stroke="${stroke}" stroke-width="1.5" />
    <text x="${x + LEGEND_SWATCH + 6}" y="${y + LEGEND_SWATCH - 1}" fill="#94a3b8" font-size="8">${PALETTE_LABELS[key]}</text>`;
		})
		.join("\n    ");
	return `<g>\n    ${rows}\n  </g>`;
}

/** Renders just the `<svg>` element for the diagram. */
export function renderDiagramSvg(diagram: DiagramData): string {
	const { placed, width, height } = layout(diagram);
	const centers = new Map(
		placed.map((component) => [
			component.name,
			{ x: component.x + BOX_WIDTH / 2, y: component.y + BOX_HEIGHT / 2 },
		]),
	);

	const { markup: boundaryMarkup, bottom } = renderBoundaries(
		diagram.boundaries,
		{ width, height },
	);
	const usedPalettes = [
		...new Set(placed.map((component) => component.palette)),
	];
	// Legend sits clear of every boundary box, per the skill's placement rule.
	const legendTop = bottom + LEGEND_GAP;
	const legendRows = Math.ceil(
		usedPalettes.length / Math.max(1, Math.floor(width / 200)),
	);

	// Seed the label placer with the component boxes so labels dodge them too.
	const placedLabels: LabelBox[] = placed.map((component) => ({
		x: component.x + BOX_WIDTH / 2,
		y: component.y + BOX_HEIGHT / 2,
		width: BOX_WIDTH,
		height: BOX_HEIGHT,
	}));
	const rendered = diagram.connections.map((connection) =>
		renderConnection(connection, centers, placedLabels),
	);
	const boundaryPad = diagram.boundaries.length * BOUNDARY_PAD;
	const minX = -boundaryPad - CANVAS_PAD;
	const minY = -boundaryPad - BOUNDARY_LABEL_SPACE - CANVAS_PAD;
	const viewWidth = width + boundaryPad * 2 + CANVAS_PAD * 2;
	const viewHeight =
		legendTop + legendRows * LEGEND_ROW_HEIGHT - minY + CANVAS_PAD;

	return `<svg viewBox="${minX} ${minY} ${viewWidth} ${viewHeight}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
      <polygon points="0 0, 10 3.5, 0 7" fill="#64748b" />
    </marker>
    <marker id="arrowhead-security" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
      <polygon points="0 0, 10 3.5, 0 7" fill="#fb7185" />
    </marker>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1e293b" stroke-width="0.5" />
    </pattern>
  </defs>
  <rect x="${minX}" y="${minY}" width="${viewWidth}" height="${viewHeight}" fill="url(#grid)" />
  ${boundaryMarkup}
  ${rendered.map((connection) => connection.line).join("\n  ")}
  ${placed.map(renderComponent).join("\n  ")}
  ${rendered.map((connection) => connection.label).join("\n  ")}
  ${renderLegend(usedPalettes, legendTop, width)}
</svg>`;
}

function renderHeader(options: RenderDiagramOptions): string {
	const logo = options.brand?.logoUrl
		? `<img class="logo" src="${escapeXml(options.brand.logoUrl)}" alt="" />`
		: '<div class="pulse-dot"></div>';
	const title = options.brand?.companyName ?? options.fallbackTitle;
	const subtitle = options.subtitle
		? `<p class="subtitle">${escapeXml(options.subtitle)}</p>`
		: "";
	return `<div class="header">
      <div class="header-row">
        ${logo}
        <h1>${escapeXml(title)} Architecture</h1>
      </div>
      ${subtitle}
    </div>`;
}

function renderCards(diagram: DiagramData): string {
	const zones = [
		...new Set(
			diagram.components
				.map((component) => component.zone)
				.filter((zone): zone is string => Boolean(zone)),
		),
	];
	const cards: Array<{ dot: string; title: string; items: string[] }> = [
		{
			dot: "cyan",
			title: "Components",
			items: diagram.components.map(
				(component) => `${component.name} (${paletteFor(component.type)})`,
			),
		},
		{
			dot: "violet",
			title: "Data zones",
			items: zones.length > 0 ? zones : ["No zones declared"],
		},
		{
			dot: "amber",
			title: "Boundaries",
			items:
				diagram.boundaries.length > 0
					? diagram.boundaries.map(
							(boundary) => `${boundary.label} (${boundary.type ?? "region"})`,
						)
					: ["No boundaries declared"],
		},
	];

	return cards
		.map(
			(card) => `<div class="card">
        <div class="card-header">
          <div class="card-dot ${card.dot}"></div>
          <h3>${card.title}</h3>
        </div>
        <ul>
          ${card.items.map((item) => `<li>• ${escapeXml(item)}</li>`).join("\n          ")}
        </ul>
      </div>`,
		)
		.join("\n      ");
}

/**
 * Renders the diagram as a single self-contained HTML document: all CSS and SVG
 * inline, no JavaScript, Google Fonts the only external reference.
 */
export function renderDiagramHtml(options: RenderDiagramOptions): string {
	const title = options.brand?.companyName ?? options.fallbackTitle;
	return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeXml(title)} Architecture Diagram</title>
    <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />
    <style>
      * { box-sizing: border-box; padding: 0; margin: 0; }
      body { min-height: 100vh; padding: 2rem; font-family: "JetBrains Mono", monospace; color: white; background: #020617; }
      .container { max-width: 1200px; margin: 0 auto; }
      .header { margin-bottom: 2rem; }
      .header-row { display: flex; gap: 1rem; align-items: center; margin-bottom: 0.5rem; }
      .pulse-dot { width: 12px; height: 12px; background: #22d3ee; border-radius: 50%; animation: pulse 2s infinite; }
      .logo { width: 28px; height: 28px; object-fit: contain; border-radius: 4px; }
      @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
      h1 { font-size: 1.5rem; font-weight: 700; letter-spacing: -0.025em; }
      .subtitle { margin-left: 1.75rem; font-size: 0.875rem; color: #94a3b8; }
      .diagram-container { padding: 1.5rem; overflow-x: auto; background: rgba(15, 23, 42, 0.5); border: 1px solid #1e293b; border-radius: 1rem; }
      svg { display: block; width: 100%; min-width: 720px; }
      .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1rem; margin-top: 2rem; }
      .card { padding: 1.25rem; background: rgba(15, 23, 42, 0.5); border: 1px solid #1e293b; border-radius: 0.75rem; }
      .card-header { display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.75rem; }
      .card-dot { width: 8px; height: 8px; border-radius: 50%; }
      .card-dot.cyan { background: #22d3ee; }
      .card-dot.violet { background: #a78bfa; }
      .card-dot.amber { background: #fbbf24; }
      .card h3 { font-size: 0.875rem; font-weight: 600; }
      .card ul { font-size: 0.75rem; color: #94a3b8; list-style: none; }
      .card li { margin-bottom: 0.375rem; }
      .footer { margin-top: 1.5rem; font-size: 0.75rem; color: #475569; text-align: center; }
    </style>
  </head>
  <body>
    <div class="container">
      ${renderHeader(options)}
      <div class="diagram-container">
        ${renderDiagramSvg(options.diagram)}
      </div>
      <div class="cards">
        ${renderCards(options.diagram)}
      </div>
      <p class="footer">Generated by agentflow from agentflow-mcp arch_pattern_lookup</p>
    </div>
  </body>
</html>`;
}

/** Minimal shape of a captured MCP tool call (see PipelineResult.toolCalls). */
interface ToolCallLike {
	tool: string;
	arguments?: unknown;
	result: unknown;
}

/** Why no diagram is available, when there is none. */
export type DiagramUnavailableReason = "weak-match" | "no-diagram-data";

// Tool names are duplicated from $lib/mcp/server rather than imported: that
// module reads private env and must not be pulled into the browser bundle.
const BRAND_SEARCH = "brand_search";
const BRAND_CONTEXT_LOOKUP = "brand_context_lookup";

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function asStringArrayItem(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseComponents(value: unknown): DiagramComponent[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const components: DiagramComponent[] = [];
	for (const entry of value) {
		const record = asRecord(entry);
		const name = asStringArrayItem(record?.name);
		if (record && name) {
			components.push({
				name,
				type: asStringArrayItem(record.type),
				sublabel: asStringArrayItem(record.sublabel),
				zone: asStringArrayItem(record.zone),
			});
		}
	}
	return components;
}

function parseConnections(value: unknown): DiagramConnection[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const connections: DiagramConnection[] = [];
	for (const entry of value) {
		const record = asRecord(entry);
		const from = asStringArrayItem(record?.from);
		const to = asStringArrayItem(record?.to);
		if (record && from && to) {
			connections.push({
				from,
				to,
				label: asStringArrayItem(record.label),
				style: asStringArrayItem(record.style),
			});
		}
	}
	return connections;
}

function parseBoundaries(value: unknown): DiagramBoundary[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const boundaries: DiagramBoundary[] = [];
	for (const entry of value) {
		const record = asRecord(entry);
		const label = asStringArrayItem(record?.label);
		if (record && label) {
			boundaries.push({ label, type: asStringArrayItem(record.type) });
		}
	}
	return boundaries;
}

/**
 * Validates an `arch_diagram` tool result's `diagram_data` payload. Returns
 * null when the payload is missing or carries no renderable components (the
 * fallback pattern returns available=false with diagram_data=null).
 */
export function parseDiagramData(value: unknown): DiagramData | null {
	const record = asRecord(value);
	if (!record) {
		return null;
	}
	const components = parseComponents(record.components);
	if (components.length === 0) {
		return null;
	}
	return {
		components,
		connections: parseConnections(record.connections),
		boundaries: parseBoundaries(record.boundaries),
	};
}

/**
 * Pulls the confirmed brand out of a run's MCP tool calls. The logo and name
 * come from the `brand_search` candidate the Architect selected (matched by
 * the domain passed to `brand_context_lookup`), because brand_search is what
 * surfaces the logo in the conversation; `brand_context_lookup` enriches but
 * is not the logo source. Falls back to the brand_context_lookup result when
 * brand_search was skipped (explicit domain hint) — and to null when brand
 * context is unavailable, which only costs the logo.
 */
export function brandFromToolCalls(
	toolCalls: readonly ToolCallLike[],
): BrandContext | null {
	const searchResult = asRecord(
		toolCalls.find((call) => call.tool === BRAND_SEARCH)?.result,
	);
	const contextCall = toolCalls.find(
		(call) => call.tool === BRAND_CONTEXT_LOOKUP,
	);
	const contextDomain = asStringArrayItem(
		asRecord(contextCall?.arguments)?.domain,
	);

	if (Array.isArray(searchResult?.candidates)) {
		const candidates = searchResult.candidates
			.map(asRecord)
			.filter(
				(candidate): candidate is Record<string, unknown> => candidate !== null,
			);
		const selected =
			(contextDomain
				? candidates.find(
						(candidate) =>
							asStringArrayItem(candidate.domain) === contextDomain,
					)
				: undefined) ?? candidates[0];
		const companyName = asStringArrayItem(selected?.name);
		const logoUrl = asStringArrayItem(selected?.logo_url);
		if (companyName || logoUrl) {
			return { companyName, logoUrl };
		}
	}

	const contextResult = asRecord(contextCall?.result);
	const companyName = asStringArrayItem(contextResult?.company_name);
	const logoUrl = asStringArrayItem(contextResult?.logo_url);
	return companyName || logoUrl ? { companyName, logoUrl } : null;
}
