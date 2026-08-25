## Purpose

Renders a dark-themed SVG architecture diagram from `diagram_data` returned by the agentflow-mcp's `arch_diagram` tool (fetched on demand, after risk evaluation), displaying the recommended deployment architecture with branded header and semantic component colors.

## ADDED Requirements

### Requirement: SVG Rendering from Diagram Data

When `arch_diagram` returns `available` as true with `diagram_data` (for curated patterns), the system SHALL render an SVG diagram containing the components, connections, and boundaries from the diagram_data object. The diagram SHALL be rendered as a self-contained HTML file with inline CSS and SVG.

#### Scenario: Curated pattern renders diagram

- **WHEN** `arch_diagram` returns available=true with diagram_data containing components (e.g., BigQuery, SAML SSO), connections (e.g., Users → SAML SSO), and boundaries (e.g., GCP EU Region)
- **THEN** the system SHALL render an SVG diagram showing all components as rounded rectangles, connections as arrows, and boundaries as dashed region boxes

### Requirement: Branded Diagram Header

The diagram header SHALL include the company logo and company name from the confirmed `brand_search` candidate (`logo_url` and `name`), which was already displayed in the conversation during brand resolution. `brand_context_lookup` enriches the brand context but is not the logo source. Brand colors SHALL be used only for the header accent, not for component colors.

#### Scenario: Branded header with logo

- **WHEN** a brand_search candidate has been confirmed with a logo_url and name
- **THEN** the diagram header SHALL display the company logo and company name
- **AND** brand colors SHALL be used only for the header accent, not for component rendering

### Requirement: Semantic Component Color Palette

Components SHALL be color-coded using a semantic palette: cyan for frontend, emerald for backend, violet for database, amber for cloud/infrastructure, rose for security, orange for message bus, and slate for external services.

#### Scenario: Database component uses violet

- **WHEN** the diagram renders a component with type=database (e.g., BigQuery)
- **THEN** the component SHALL use violet fill and stroke colors

#### Scenario: Security component uses rose

- **WHEN** the diagram renders a component with type=security (e.g., SAML SSO)
- **THEN** the component SHALL use rose fill and stroke colors

### Requirement: Connection Rendering

Connections between components SHALL be rendered as arrows with labels. Security flows SHALL use dashed rose-colored lines. Region boundaries SHALL be large dashed amber-colored boxes.

#### Scenario: Standard connection

- **WHEN** diagram_data contains a connection from Users to SAML SSO with label "OAuth 2.0"
- **THEN** an arrow SHALL be drawn from the Users component to the SAML SSO component with the label "OAuth 2.0"

#### Scenario: Security flow connection

- **WHEN** diagram_data contains a connection with style=security
- **THEN** the arrow SHALL be rendered as a dashed rose-colored line

### Requirement: Fallback When No Diagram Data

When `arch_diagram` returns `available` as false (e.g., for the `generic_enterprise_ai_poc` fallback pattern) or no diagram was requested, the system SHALL NOT render an architecture diagram. The UI SHALL indicate that no diagram is available for this scenario.

#### Scenario: No diagram for fallback match

- **WHEN** `arch_pattern_lookup` returned a low-confidence fallback pattern AND `arch_diagram` returns available=false
- **THEN** no architecture diagram SHALL be rendered
- **AND** the UI SHALL indicate that no diagram is available for this scenario

#### Scenario: No diagram requested

- **WHEN** a pipeline run completes without the user requesting a diagram
- **THEN** `arch_diagram` SHALL NOT be called
- **AND** no architecture diagram SHALL be rendered

### Requirement: Fallback When Brand Context Unavailable

When brand resolution (`brand_search` / `brand_context_lookup`) returns unavailable, the diagram SHALL render without a branded header. The diagram SHALL use a default header with the pattern name or scenario name instead.

#### Scenario: Diagram without brand context

- **WHEN** brand resolution returns unavailable AND `arch_diagram` returns available=true with diagram_data
- **THEN** the diagram SHALL render with a default header (pattern name or scenario name)
- **AND** no company logo SHALL be displayed

### Requirement: Standalone HTML Output

The diagram SHALL be rendered as a single self-contained HTML file with all CSS and SVG inline. The only external dependency SHALL be Google Fonts (JetBrains Mono). No JavaScript SHALL be used for rendering.

#### Scenario: Diagram opens in browser

- **WHEN** the architecture diagram is generated
- **THEN** it SHALL be openable in any modern web browser as a standalone HTML file
- **AND** all CSS and SVG SHALL be inline (no external stylesheets or scripts)
