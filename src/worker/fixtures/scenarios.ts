import type {
  CellState,
  ColumnSpec,
  Criterion,
  CriterionVerdict,
  EntityType,
  EvidenceKind,
  SourceTier,
} from "../../lib/contracts";

type FixtureSource = {
  id: string;
  url: string;
  title: string;
  snippet: string;
  trustTier?: SourceTier;
};

type FixtureCell = {
  valueText: string | null;
  state: CellState;
  confidence: number;
  reasonCode?: string | null;
  sourceIds: string[];
  evidenceKind?: EvidenceKind;
};

type FixtureCriterionEvaluation = {
  label: string;
  verdict: CriterionVerdict;
  summary: string;
  confidence: number;
  sourceIds: string[];
};

export type FixtureCandidate = {
  id: string;
  name: string;
  url: string;
  status: "accepted" | "rejected" | "uncertain" | "conflict";
  score: number;
  sources: FixtureSource[];
  cells: Record<string, FixtureCell>;
  evaluations: FixtureCriterionEvaluation[];
};

export type FixtureScenario = {
  id: string;
  category: "startups" | "oss" | "docs" | "local" | "news";
  query: string;
  entityType: EntityType;
  hardFilters: string[];
  softSignals: string[];
  columns: Array<
    Pick<
      ColumnSpec,
      | "key"
      | "label"
      | "kind"
      | "valueType"
      | "preferredSources"
      | "requiresVerification"
      | "allowInference"
      | "nullPolicy"
      | "orderIndex"
    >
  >;
  searchQueries: string[];
  budgets: {
    searchBudget: number;
    fetchBudget: number;
    verificationBudget: number;
  };
  notes: string;
  candidates: FixtureCandidate[];
};

function source(
  id: string,
  url: string,
  title: string,
  snippet: string,
  trustTier: SourceTier = "official",
): FixtureSource {
  return { id, url, title, snippet, trustTier };
}

function cell(
  valueText: string | null,
  sourceIds: string[],
  state: CellState = "filled",
  confidence = 0.92,
  reasonCode: string | null = null,
  evidenceKind: EvidenceKind = "snippet",
): FixtureCell {
  return { valueText, sourceIds, state, confidence, reasonCode, evidenceKind };
}

function criterion(
  label: string,
  verdict: CriterionVerdict,
  summary: string,
  sourceIds: string[],
  confidence = 0.9,
): FixtureCriterionEvaluation {
  return { label, verdict, summary, sourceIds, confidence };
}

function columns(
  defs: FixtureScenario["columns"],
  threadId: string,
): ColumnSpec[] {
  return defs.map((column) => ({
    id: `${threadId}:${column.key}`,
    threadId,
    ...column,
  }));
}

function criteriaFromScenario(scenario: FixtureScenario, threadId: string): Criterion[] {
  return [
    ...scenario.hardFilters.map((label, index) => ({
      id: `${threadId}:criterion:hard:${index}`,
      threadId,
      label,
      kind: "hard_filter" as const,
      color: HARD_FILTER_COLORS[index % HARD_FILTER_COLORS.length],
      orderIndex: index,
    })),
    ...scenario.softSignals.map((label, index) => ({
      id: `${threadId}:criterion:soft:${index}`,
      threadId,
      label,
      kind: "soft_signal" as const,
      color: SOFT_SIGNAL_COLORS[index % SOFT_SIGNAL_COLORS.length],
      orderIndex: scenario.hardFilters.length + index,
    })),
  ];
}

const HARD_FILTER_COLORS = [
  "hsl(220, 80%, 50%)",
  "hsl(142, 71%, 45%)",
  "hsl(38, 92%, 50%)",
];

const SOFT_SIGNAL_COLORS = [
  "hsl(280, 60%, 50%)",
  "hsl(350, 70%, 50%)",
];

export const smokeScenarios: FixtureScenario[] = [
  {
    id: "yc-w24-healthcare",
    category: "startups",
    query: "YC W24 healthcare startups",
    entityType: "company",
    hardFilters: ["Y Combinator batch is W24", "Healthcare or biotech focus"],
    softSignals: ["Evidence of enterprise or clinical workflow relevance"],
    columns: [
      { key: "website", label: "Website", kind: "identity", valueType: "url", preferredSources: ["official"], requiresVerification: true, allowInference: false, nullPolicy: "dash", orderIndex: 0 },
      { key: "description", label: "Description", kind: "enrichment", valueType: "string", preferredSources: ["official", "reputable_secondary"], requiresVerification: true, allowInference: true, nullPolicy: "dash", orderIndex: 1 },
      { key: "location", label: "Location", kind: "enrichment", valueType: "string", preferredSources: ["official"], requiresVerification: true, allowInference: false, nullPolicy: "dash", orderIndex: 2 },
      { key: "yc_batch", label: "YC Batch", kind: "criterion_summary", valueType: "string", preferredSources: ["official"], requiresVerification: true, allowInference: false, nullPolicy: "dash", orderIndex: 3 },
      { key: "evidence_count", label: "Evidence", kind: "criterion_summary", valueType: "number", preferredSources: ["official"], requiresVerification: false, allowInference: false, nullPolicy: "dash", orderIndex: 4 },
    ],
    searchQueries: [
      "site:ycombinator.com W24 healthcare startup",
      "YC W24 healthcare startup companies",
      "W24 healthcare startup ycombinator",
    ],
    budgets: { searchBudget: 3, fetchBudget: 12, verificationBudget: 6 },
    notes: "Prioritize YC directory pages and official company sites.",
    candidates: [
      {
        id: "row-sprout",
        name: "Sprout Labs",
        url: "sproutlabs.health",
        status: "accepted",
        score: 0.95,
        sources: [
          source("src-sprout-yc", "https://www.ycombinator.com/companies/sprout-labs", "Sprout Labs | Y Combinator", "W24 startup building clinical intake automation."),
          source("src-sprout-site", "https://sproutlabs.health", "Sprout Labs", "Clinical intake and documentation automation for providers."),
        ],
        cells: {
          website: cell("https://sproutlabs.health", ["src-sprout-site"]),
          description: cell("Clinical intake and documentation automation for providers.", ["src-sprout-site"]),
          location: cell("New York, NY", ["src-sprout-site"]),
          yc_batch: cell("W24", ["src-sprout-yc"]),
          evidence_count: cell("2", ["src-sprout-yc", "src-sprout-site"]),
        },
        evaluations: [
          criterion("Y Combinator batch is W24", "pass", "YC company page lists W24.", ["src-sprout-yc"]),
          criterion("Healthcare or biotech focus", "pass", "Official site describes provider workflow automation.", ["src-sprout-site"]),
          criterion("Evidence of enterprise or clinical workflow relevance", "pass", "Official messaging is aimed at provider operations.", ["src-sprout-site"]),
        ],
      },
      {
        id: "row-lattice-bio",
        name: "Lattice Bio",
        url: "latticebio.dev",
        status: "accepted",
        score: 0.91,
        sources: [
          source("src-lattice-yc", "https://www.ycombinator.com/companies/lattice-bio", "Lattice Bio | Y Combinator", "W24 biotech startup."),
          source("src-lattice-site", "https://latticebio.dev", "Lattice Bio", "Computational tools for therapeutic design and wet-lab collaboration."),
        ],
        cells: {
          website: cell("https://latticebio.dev", ["src-lattice-site"]),
          description: cell("Computational tools for therapeutic design and wet-lab collaboration.", ["src-lattice-site"]),
          location: cell("San Francisco, CA", ["src-lattice-site"]),
          yc_batch: cell("W24", ["src-lattice-yc"]),
          evidence_count: cell("2", ["src-lattice-yc", "src-lattice-site"]),
        },
        evaluations: [
          criterion("Y Combinator batch is W24", "pass", "YC company directory labels the team as W24.", ["src-lattice-yc"]),
          criterion("Healthcare or biotech focus", "pass", "The company works on therapeutics and wet-lab workflows.", ["src-lattice-site"]),
          criterion("Evidence of enterprise or clinical workflow relevance", "uncertain", "Therapeutics relevance is clear, enterprise focus is implied but not explicit.", ["src-lattice-site"], 0.62),
        ],
      },
      {
        id: "row-quill-fit",
        name: "Quill Fit",
        url: "quillfit.app",
        status: "rejected",
        score: 0.31,
        sources: [
          source("src-quill-yc", "https://www.ycombinator.com/companies/quill-fit", "Quill Fit | Y Combinator", "W24 consumer fitness startup."),
        ],
        cells: {
          website: cell("https://quillfit.app", ["src-quill-yc"], "uncertain", 0.48, "weak_source"),
          description: cell("Consumer fitness habit tracking app.", ["src-quill-yc"]),
          location: cell(null, ["src-quill-yc"], "not_found", 0.2, "location_missing"),
          yc_batch: cell("W24", ["src-quill-yc"]),
          evidence_count: cell("1", ["src-quill-yc"]),
        },
        evaluations: [
          criterion("Y Combinator batch is W24", "pass", "Listed in the YC directory.", ["src-quill-yc"]),
          criterion("Healthcare or biotech focus", "fail", "The result appears to be general consumer fitness rather than healthcare/biotech.", ["src-quill-yc"]),
          criterion("Evidence of enterprise or clinical workflow relevance", "fail", "No enterprise or clinical workflow evidence was found.", ["src-quill-yc"]),
        ],
      },
    ],
  },
  {
    id: "climate-europe",
    category: "startups",
    query: "Climate-tech startups in Europe",
    entityType: "company",
    hardFilters: ["Company is headquartered in Europe", "Company works on climate or decarbonization"],
    softSignals: ["Evidence of commercial deployment"],
    columns: [
      { key: "website", label: "Website", kind: "identity", valueType: "url", preferredSources: ["official"], requiresVerification: true, allowInference: false, nullPolicy: "dash", orderIndex: 0 },
      { key: "description", label: "Description", kind: "enrichment", valueType: "string", preferredSources: ["official"], requiresVerification: true, allowInference: true, nullPolicy: "dash", orderIndex: 1 },
      { key: "hq", label: "HQ", kind: "enrichment", valueType: "string", preferredSources: ["official"], requiresVerification: true, allowInference: false, nullPolicy: "dash", orderIndex: 2 },
      { key: "segment", label: "Segment", kind: "enrichment", valueType: "string", preferredSources: ["official"], requiresVerification: true, allowInference: true, nullPolicy: "dash", orderIndex: 3 },
    ],
    searchQueries: ["Europe climate-tech startup", "European decarbonization startups", "climate tech company Europe"],
    budgets: { searchBudget: 3, fetchBudget: 10, verificationBudget: 5 },
    notes: "Prefer official sites and reputable ecosystem directories.",
    candidates: [
      {
        id: "row-gridforge",
        name: "GridForge",
        url: "gridforge.eu",
        status: "accepted",
        score: 0.93,
        sources: [
          source("src-gridforge-site", "https://gridforge.eu", "GridForge", "Grid optimization software for distributed energy assets."),
        ],
        cells: {
          website: cell("https://gridforge.eu", ["src-gridforge-site"]),
          description: cell("Grid optimization software for distributed energy assets.", ["src-gridforge-site"]),
          hq: cell("Berlin, Germany", ["src-gridforge-site"]),
          segment: cell("Grid software", ["src-gridforge-site"]),
        },
        evaluations: [
          criterion("Company is headquartered in Europe", "pass", "The official site lists Berlin, Germany.", ["src-gridforge-site"]),
          criterion("Company works on climate or decarbonization", "pass", "The product targets distributed energy optimization.", ["src-gridforge-site"]),
          criterion("Evidence of commercial deployment", "uncertain", "The site implies deployments but does not quantify them.", ["src-gridforge-site"], 0.64),
        ],
      },
      {
        id: "row-carbonledger",
        name: "CarbonLedger",
        url: "carbonledger.co",
        status: "accepted",
        score: 0.89,
        sources: [
          source("src-carbon-site", "https://carbonledger.co", "CarbonLedger", "Embedded carbon accounting for manufacturing teams."),
        ],
        cells: {
          website: cell("https://carbonledger.co", ["src-carbon-site"]),
          description: cell("Embedded carbon accounting for manufacturing teams.", ["src-carbon-site"]),
          hq: cell("Paris, France", ["src-carbon-site"]),
          segment: cell("Carbon accounting", ["src-carbon-site"]),
        },
        evaluations: [
          criterion("Company is headquartered in Europe", "pass", "The company lists Paris, France as headquarters.", ["src-carbon-site"]),
          criterion("Company works on climate or decarbonization", "pass", "The product is clearly climate-focused accounting software.", ["src-carbon-site"]),
          criterion("Evidence of commercial deployment", "pass", "The site references manufacturing customers and deployment claims.", ["src-carbon-site"]),
        ],
      },
    ],
  },
  {
    id: "oss-llm-1k",
    category: "oss",
    query: "Open source LLM projects with >1k GitHub stars",
    entityType: "project",
    hardFilters: ["Project is open source", "Project is related to LLMs or language models", "Project has more than 1000 GitHub stars"],
    softSignals: ["Healthy maintenance activity"],
    columns: [
      { key: "repo", label: "Repo", kind: "identity", valueType: "url", preferredSources: ["official"], requiresVerification: true, allowInference: false, nullPolicy: "dash", orderIndex: 0 },
      { key: "stars", label: "Stars", kind: "enrichment", valueType: "number", preferredSources: ["official"], requiresVerification: true, allowInference: false, nullPolicy: "dash", orderIndex: 1 },
      { key: "language", label: "Language", kind: "enrichment", valueType: "string", preferredSources: ["official"], requiresVerification: true, allowInference: false, nullPolicy: "dash", orderIndex: 2 },
      { key: "license", label: "License", kind: "enrichment", valueType: "string", preferredSources: ["official"], requiresVerification: true, allowInference: false, nullPolicy: "dash", orderIndex: 3 },
    ],
    searchQueries: ["site:github.com open source llm project stars", "LLM GitHub repository 1000 stars", "language model OSS GitHub"],
    budgets: { searchBudget: 3, fetchBudget: 9, verificationBudget: 6 },
    notes: "Prefer GitHub metadata and official docs for grounding.",
    candidates: [
      {
        id: "row-llm-observatory",
        name: "LLM Observatory",
        url: "github.com/example/llm-observatory",
        status: "accepted",
        score: 0.94,
        sources: [
          source("src-observatory-repo", "https://github.com/example/llm-observatory", "example/llm-observatory", "Open-source toolkit for evaluating and debugging LLM systems."),
        ],
        cells: {
          repo: cell("https://github.com/example/llm-observatory", ["src-observatory-repo"]),
          stars: cell("4200", ["src-observatory-repo"]),
          language: cell("Python", ["src-observatory-repo"]),
          license: cell("Apache-2.0", ["src-observatory-repo"]),
        },
        evaluations: [
          criterion("Project is open source", "pass", "The repository is public and includes a license.", ["src-observatory-repo"]),
          criterion("Project is related to LLMs or language models", "pass", "The repo description is explicitly about LLM systems.", ["src-observatory-repo"]),
          criterion("Project has more than 1000 GitHub stars", "pass", "The repository shows more than 1k stars.", ["src-observatory-repo"]),
          criterion("Healthy maintenance activity", "pass", "The repository shows recent activity.", ["src-observatory-repo"]),
        ],
      },
      {
        id: "row-contextkit",
        name: "ContextKit",
        url: "github.com/example/contextkit",
        status: "accepted",
        score: 0.9,
        sources: [
          source("src-contextkit-repo", "https://github.com/example/contextkit", "example/contextkit", "Context management and retrieval primitives for LLM applications."),
        ],
        cells: {
          repo: cell("https://github.com/example/contextkit", ["src-contextkit-repo"]),
          stars: cell("1800", ["src-contextkit-repo"]),
          language: cell("TypeScript", ["src-contextkit-repo"]),
          license: cell("MIT", ["src-contextkit-repo"]),
        },
        evaluations: [
          criterion("Project is open source", "pass", "The repository is public and licensed.", ["src-contextkit-repo"]),
          criterion("Project is related to LLMs or language models", "pass", "The repository description references LLM applications.", ["src-contextkit-repo"]),
          criterion("Project has more than 1000 GitHub stars", "pass", "The repository exceeds the requested star threshold.", ["src-contextkit-repo"]),
          criterion("Healthy maintenance activity", "uncertain", "Maintenance looks active, but the latest release cadence is modest.", ["src-contextkit-repo"], 0.66),
        ],
      },
    ],
  },
  {
    id: "oss-observability",
    category: "oss",
    query: "OSS observability tools with self-hosting docs",
    entityType: "project",
    hardFilters: ["Project is open source", "Project is an observability tool", "Project has self-hosting documentation"],
    softSignals: ["Evidence of active docs maintenance"],
    columns: [
      { key: "repo", label: "Repo", kind: "identity", valueType: "url", preferredSources: ["official"], requiresVerification: true, allowInference: false, nullPolicy: "dash", orderIndex: 0 },
      { key: "docs", label: "Docs", kind: "identity", valueType: "url", preferredSources: ["official"], requiresVerification: true, allowInference: false, nullPolicy: "dash", orderIndex: 1 },
      { key: "deployment", label: "Deployment", kind: "enrichment", valueType: "string", preferredSources: ["official"], requiresVerification: true, allowInference: true, nullPolicy: "dash", orderIndex: 2 },
      { key: "stars", label: "Stars", kind: "enrichment", valueType: "number", preferredSources: ["official"], requiresVerification: true, allowInference: false, nullPolicy: "dash", orderIndex: 3 },
    ],
    searchQueries: ["open source observability self hosting docs", "OSS observability docs self-hosted", "GitHub observability tool self host docs"],
    budgets: { searchBudget: 3, fetchBudget: 9, verificationBudget: 5 },
    notes: "Prefer docs pages with deployment guides.",
    candidates: [
      {
        id: "row-signalkit",
        name: "SignalKit",
        url: "github.com/example/signalkit",
        status: "accepted",
        score: 0.92,
        sources: [
          source("src-signalkit-repo", "https://github.com/example/signalkit", "example/signalkit", "Open-source traces and logs platform."),
          source("src-signalkit-docs", "https://docs.signalkit.dev/self-hosting", "SignalKit self-hosting", "Guide for self-hosting SignalKit on Kubernetes."),
        ],
        cells: {
          repo: cell("https://github.com/example/signalkit", ["src-signalkit-repo"]),
          docs: cell("https://docs.signalkit.dev/self-hosting", ["src-signalkit-docs"]),
          deployment: cell("Kubernetes self-hosted", ["src-signalkit-docs"]),
          stars: cell("3200", ["src-signalkit-repo"]),
        },
        evaluations: [
          criterion("Project is open source", "pass", "The repository is public and licensed.", ["src-signalkit-repo"]),
          criterion("Project is an observability tool", "pass", "The repo describes traces and logs capabilities.", ["src-signalkit-repo"]),
          criterion("Project has self-hosting documentation", "pass", "The docs include a dedicated self-hosting guide.", ["src-signalkit-docs"]),
          criterion("Evidence of active docs maintenance", "pass", "The docs show current deployment guidance and recent updates.", ["src-signalkit-docs"]),
        ],
      },
      {
        id: "row-metricforge",
        name: "MetricForge",
        url: "github.com/example/metricforge",
        status: "accepted",
        score: 0.88,
        sources: [
          source("src-metricforge-repo", "https://github.com/example/metricforge", "example/metricforge", "Metrics and dashboards for modern apps."),
          source("src-metricforge-docs", "https://metricforge.dev/docs/install", "MetricForge install docs", "Installation docs for self-hosting MetricForge."),
        ],
        cells: {
          repo: cell("https://github.com/example/metricforge", ["src-metricforge-repo"]),
          docs: cell("https://metricforge.dev/docs/install", ["src-metricforge-docs"]),
          deployment: cell("Docker Compose", ["src-metricforge-docs"]),
          stars: cell("2100", ["src-metricforge-repo"]),
        },
        evaluations: [
          criterion("Project is open source", "pass", "The GitHub repository is public.", ["src-metricforge-repo"]),
          criterion("Project is an observability tool", "pass", "The project is focused on metrics and dashboards.", ["src-metricforge-repo"]),
          criterion("Project has self-hosting documentation", "pass", "Installation docs show self-hosting steps.", ["src-metricforge-docs"]),
          criterion("Evidence of active docs maintenance", "uncertain", "The docs appear valid, but freshness is not strongly signaled.", ["src-metricforge-docs"], 0.63),
        ],
      },
    ],
  },
  {
    id: "react-state-docs",
    category: "docs",
    query: "Docs sites for React state management libraries",
    entityType: "website",
    hardFilters: ["Site documents a React state management library"],
    softSignals: ["Interactive examples or strong getting-started flow"],
    columns: [
      { key: "docs_url", label: "Docs URL", kind: "identity", valueType: "url", preferredSources: ["official"], requiresVerification: true, allowInference: false, nullPolicy: "dash", orderIndex: 0 },
      { key: "library", label: "Library", kind: "enrichment", valueType: "string", preferredSources: ["official"], requiresVerification: true, allowInference: false, nullPolicy: "dash", orderIndex: 1 },
      { key: "interactive_examples", label: "Interactive examples", kind: "enrichment", valueType: "string", preferredSources: ["official"], requiresVerification: true, allowInference: true, nullPolicy: "dash", orderIndex: 2 },
      { key: "getting_started", label: "Getting started", kind: "enrichment", valueType: "string", preferredSources: ["official"], requiresVerification: true, allowInference: true, nullPolicy: "dash", orderIndex: 3 },
    ],
    searchQueries: ["React state management docs site", "official docs React store library", "React state management getting started docs"],
    budgets: { searchBudget: 3, fetchBudget: 8, verificationBudget: 4 },
    notes: "Prefer official docs domains rather than blog posts.",
    candidates: [
      {
        id: "row-storehouse",
        name: "Storehouse Docs",
        url: "docs.storehouse.dev",
        status: "accepted",
        score: 0.91,
        sources: [
          source("src-storehouse-docs", "https://docs.storehouse.dev", "Storehouse Docs", "State management library docs with interactive examples."),
        ],
        cells: {
          docs_url: cell("https://docs.storehouse.dev", ["src-storehouse-docs"]),
          library: cell("Storehouse", ["src-storehouse-docs"]),
          interactive_examples: cell("Yes", ["src-storehouse-docs"]),
          getting_started: cell("Guided tutorial with quick start", ["src-storehouse-docs"]),
        },
        evaluations: [
          criterion("Site documents a React state management library", "pass", "The docs clearly position Storehouse as a React state library.", ["src-storehouse-docs"]),
          criterion("Interactive examples or strong getting-started flow", "pass", "The site highlights interactive examples and a quick start.", ["src-storehouse-docs"]),
        ],
      },
      {
        id: "row-ripple-state",
        name: "Ripple State Docs",
        url: "ripple-state.dev/docs",
        status: "accepted",
        score: 0.86,
        sources: [
          source("src-ripple-docs", "https://ripple-state.dev/docs", "Ripple State Documentation", "Documentation for Ripple State, a React state management toolkit."),
        ],
        cells: {
          docs_url: cell("https://ripple-state.dev/docs", ["src-ripple-docs"]),
          library: cell("Ripple State", ["src-ripple-docs"]),
          interactive_examples: cell("Partial", ["src-ripple-docs"], "uncertain", 0.58, "interactive_examples_unclear"),
          getting_started: cell("Install and first store guide", ["src-ripple-docs"]),
        },
        evaluations: [
          criterion("Site documents a React state management library", "pass", "The docs identify Ripple State as a React state toolkit.", ["src-ripple-docs"]),
          criterion("Interactive examples or strong getting-started flow", "uncertain", "The docs include setup guidance but interactive examples are not clearly emphasized.", ["src-ripple-docs"], 0.58),
        ],
      },
    ],
  },
  {
    id: "frontend-doc-sites",
    category: "docs",
    query: "Front-end documentation sites",
    entityType: "website",
    hardFilters: ["Site is an official front-end documentation property"],
    softSignals: ["Includes examples or guides"],
    columns: [
      { key: "docs_url", label: "Docs URL", kind: "identity", valueType: "url", preferredSources: ["official"], requiresVerification: true, allowInference: false, nullPolicy: "dash", orderIndex: 0 },
      { key: "topic", label: "Topic", kind: "enrichment", valueType: "string", preferredSources: ["official"], requiresVerification: true, allowInference: true, nullPolicy: "dash", orderIndex: 1 },
      { key: "examples", label: "Examples", kind: "enrichment", valueType: "string", preferredSources: ["official"], requiresVerification: true, allowInference: true, nullPolicy: "dash", orderIndex: 2 },
    ],
    searchQueries: ["front-end documentation site official", "frontend docs guides examples"],
    budgets: { searchBudget: 2, fetchBudget: 6, verificationBudget: 3 },
    notes: "Use docs domains and official framework sites.",
    candidates: [
      {
        id: "row-framekit",
        name: "FrameKit Docs",
        url: "docs.framekit.dev",
        status: "accepted",
        score: 0.85,
        sources: [
          source("src-framekit-docs", "https://docs.framekit.dev", "FrameKit Docs", "Official front-end docs with examples and deployment guides."),
        ],
        cells: {
          docs_url: cell("https://docs.framekit.dev", ["src-framekit-docs"]),
          topic: cell("UI framework", ["src-framekit-docs"]),
          examples: cell("Interactive examples and recipes", ["src-framekit-docs"]),
        },
        evaluations: [
          criterion("Site is an official front-end documentation property", "pass", "The site is the official documentation home for FrameKit.", ["src-framekit-docs"]),
          criterion("Includes examples or guides", "pass", "Examples and recipes are highlighted in the nav.", ["src-framekit-docs"]),
        ],
      },
      {
        id: "row-stylegrid",
        name: "StyleGrid Docs",
        url: "stylegrid.dev/docs",
        status: "accepted",
        score: 0.8,
        sources: [
          source("src-stylegrid-docs", "https://stylegrid.dev/docs", "StyleGrid Docs", "Design system and front-end documentation site."),
        ],
        cells: {
          docs_url: cell("https://stylegrid.dev/docs", ["src-stylegrid-docs"]),
          topic: cell("Design system", ["src-stylegrid-docs"]),
          examples: cell("Component examples", ["src-stylegrid-docs"]),
        },
        evaluations: [
          criterion("Site is an official front-end documentation property", "pass", "The docs are presented as the official StyleGrid site.", ["src-stylegrid-docs"]),
          criterion("Includes examples or guides", "pass", "Component examples and setup guides are present.", ["src-stylegrid-docs"]),
        ],
      },
    ],
  },
  {
    id: "brooklyn-pizza",
    category: "local",
    query: "Top pizza places in Brooklyn",
    entityType: "business",
    hardFilters: ["Business is a pizza place", "Business is located in Brooklyn"],
    softSignals: ["Repeated positive mentions from reputable local guides"],
    columns: [
      { key: "website", label: "Website", kind: "identity", valueType: "url", preferredSources: ["official"], requiresVerification: true, allowInference: false, nullPolicy: "dash", orderIndex: 0 },
      { key: "neighborhood", label: "Neighborhood", kind: "enrichment", valueType: "string", preferredSources: ["official", "reputable_secondary"], requiresVerification: true, allowInference: true, nullPolicy: "dash", orderIndex: 1 },
      { key: "style", label: "Style", kind: "enrichment", valueType: "string", preferredSources: ["official", "reputable_secondary"], requiresVerification: true, allowInference: true, nullPolicy: "dash", orderIndex: 2 },
      { key: "guide_signal", label: "Guide signal", kind: "criterion_summary", valueType: "string", preferredSources: ["reputable_secondary"], requiresVerification: true, allowInference: true, nullPolicy: "dash", orderIndex: 3 },
    ],
    searchQueries: ["best pizza brooklyn official site", "Brooklyn pizza local guide", "top pizza places in Brooklyn"],
    budgets: { searchBudget: 3, fetchBudget: 10, verificationBudget: 4 },
    notes: "Use official sites plus reputable local guides.",
    candidates: [
      {
        id: "row-cobble-crust",
        name: "Cobble Crust",
        url: "cobblecrustbk.com",
        status: "accepted",
        score: 0.89,
        sources: [
          source("src-cobble-site", "https://cobblecrustbk.com", "Cobble Crust", "Wood-fired pizza in Cobble Hill, Brooklyn."),
          source("src-cobble-guide", "https://brooklynbites.example.com/cobble-crust", "Brooklyn Bites", "A local favorite for wood-fired pies in Cobble Hill.", "reputable_secondary"),
        ],
        cells: {
          website: cell("https://cobblecrustbk.com", ["src-cobble-site"]),
          neighborhood: cell("Cobble Hill", ["src-cobble-site"]),
          style: cell("Wood-fired", ["src-cobble-site", "src-cobble-guide"]),
          guide_signal: cell("Recommended by local guide", ["src-cobble-guide"]),
        },
        evaluations: [
          criterion("Business is a pizza place", "pass", "The official site markets wood-fired pizza.", ["src-cobble-site"]),
          criterion("Business is located in Brooklyn", "pass", "The official site lists Cobble Hill, Brooklyn.", ["src-cobble-site"]),
          criterion("Repeated positive mentions from reputable local guides", "pass", "A reputable local guide recommends the restaurant.", ["src-cobble-guide"]),
        ],
      },
      {
        id: "row-north-slice",
        name: "North Slice",
        url: "northslicepizza.com",
        status: "accepted",
        score: 0.84,
        sources: [
          source("src-north-site", "https://northslicepizza.com", "North Slice Pizza", "Brooklyn slice shop with square pies."),
          source("src-north-guide", "https://slicejournal.example.com/north-slice", "Slice Journal", "Strong guide mention for square pies.", "reputable_secondary"),
        ],
        cells: {
          website: cell("https://northslicepizza.com", ["src-north-site"]),
          neighborhood: cell("Williamsburg", ["src-north-site"]),
          style: cell("Square pies", ["src-north-site", "src-north-guide"]),
          guide_signal: cell("Highlighted by Slice Journal", ["src-north-guide"]),
        },
        evaluations: [
          criterion("Business is a pizza place", "pass", "The business is clearly a slice shop.", ["src-north-site"]),
          criterion("Business is located in Brooklyn", "pass", "The site lists Williamsburg, Brooklyn.", ["src-north-site"]),
          criterion("Repeated positive mentions from reputable local guides", "uncertain", "Only one reputable guide mention is currently captured.", ["src-north-guide"], 0.61),
        ],
      },
    ],
  },
  {
    id: "vegan-manhattan",
    category: "local",
    query: "Restaurant guides for vegan spots in Manhattan",
    entityType: "business",
    hardFilters: ["Business is a vegan restaurant or vegan-friendly spot", "Business is located in Manhattan"],
    softSignals: ["Guide coverage from reputable sources"],
    columns: [
      { key: "website", label: "Website", kind: "identity", valueType: "url", preferredSources: ["official"], requiresVerification: true, allowInference: false, nullPolicy: "dash", orderIndex: 0 },
      { key: "location", label: "Location", kind: "enrichment", valueType: "string", preferredSources: ["official"], requiresVerification: true, allowInference: false, nullPolicy: "dash", orderIndex: 1 },
      { key: "vegan_signal", label: "Vegan signal", kind: "criterion_summary", valueType: "string", preferredSources: ["official", "reputable_secondary"], requiresVerification: true, allowInference: true, nullPolicy: "dash", orderIndex: 2 },
      { key: "guide_signal", label: "Guide signal", kind: "criterion_summary", valueType: "string", preferredSources: ["reputable_secondary"], requiresVerification: true, allowInference: true, nullPolicy: "dash", orderIndex: 3 },
    ],
    searchQueries: ["vegan restaurant Manhattan guide official", "Manhattan vegan restaurant guide", "vegan NYC Manhattan spot guide"],
    budgets: { searchBudget: 3, fetchBudget: 10, verificationBudget: 4 },
    notes: "Use official site and guide-based evidence together.",
    candidates: [
      {
        id: "row-garden-table",
        name: "Garden Table",
        url: "gardentablenyc.com",
        status: "accepted",
        score: 0.88,
        sources: [
          source("src-garden-site", "https://gardentablenyc.com", "Garden Table", "Plant-based restaurant in the East Village."),
          source("src-garden-guide", "https://nyceats.example.com/garden-table", "NYC Eats", "Recommended vegan spot in Manhattan.", "reputable_secondary"),
        ],
        cells: {
          website: cell("https://gardentablenyc.com", ["src-garden-site"]),
          location: cell("East Village, Manhattan", ["src-garden-site"]),
          vegan_signal: cell("Fully plant-based", ["src-garden-site"]),
          guide_signal: cell("Recommended by NYC Eats", ["src-garden-guide"]),
        },
        evaluations: [
          criterion("Business is a vegan restaurant or vegan-friendly spot", "pass", "The official site describes the restaurant as plant-based.", ["src-garden-site"]),
          criterion("Business is located in Manhattan", "pass", "The site lists the East Village, Manhattan.", ["src-garden-site"]),
          criterion("Guide coverage from reputable sources", "pass", "The spot appears in a reputable local guide.", ["src-garden-guide"]),
        ],
      },
      {
        id: "row-river-greens",
        name: "River Greens",
        url: "rivergreens.co",
        status: "accepted",
        score: 0.81,
        sources: [
          source("src-river-site", "https://rivergreens.co", "River Greens", "Seasonal menu with vegan offerings in Chelsea."),
        ],
        cells: {
          website: cell("https://rivergreens.co", ["src-river-site"]),
          location: cell("Chelsea, Manhattan", ["src-river-site"]),
          vegan_signal: cell("Vegan-friendly menu", ["src-river-site"], "uncertain", 0.67, "vegan_only_partial"),
          guide_signal: cell(null, ["src-river-site"], "not_found", 0.2, "guide_signal_missing"),
        },
        evaluations: [
          criterion("Business is a vegan restaurant or vegan-friendly spot", "pass", "The restaurant explicitly advertises vegan options.", ["src-river-site"]),
          criterion("Business is located in Manhattan", "pass", "The site lists Chelsea, Manhattan.", ["src-river-site"]),
          criterion("Guide coverage from reputable sources", "uncertain", "No reputable guide evidence was captured yet.", ["src-river-site"], 0.35),
        ],
      },
    ],
  },
  {
    id: "tech-ipo-news",
    category: "news",
    query: "Recent tech IPO announcements",
    entityType: "news_item",
    hardFilters: ["Item is a tech IPO announcement", "Item is recent"],
    softSignals: ["Includes company, date, and listing exchange"],
    columns: [
      { key: "article_url", label: "Article URL", kind: "identity", valueType: "url", preferredSources: ["reputable_secondary"], requiresVerification: true, allowInference: false, nullPolicy: "dash", orderIndex: 0 },
      { key: "company", label: "Company", kind: "enrichment", valueType: "string", preferredSources: ["reputable_secondary"], requiresVerification: true, allowInference: false, nullPolicy: "dash", orderIndex: 1 },
      { key: "announcement_date", label: "Date", kind: "enrichment", valueType: "date", preferredSources: ["reputable_secondary"], requiresVerification: true, allowInference: false, nullPolicy: "dash", orderIndex: 2 },
      { key: "exchange", label: "Exchange", kind: "enrichment", valueType: "string", preferredSources: ["reputable_secondary"], requiresVerification: true, allowInference: false, nullPolicy: "dash", orderIndex: 3 },
    ],
    searchQueries: ["recent tech IPO announcement", "technology IPO filing announcement", "tech IPO news latest"],
    budgets: { searchBudget: 3, fetchBudget: 10, verificationBudget: 5 },
    notes: "Use credible business news outlets.",
    candidates: [
      {
        id: "row-orbit-ipo",
        name: "Orbit Systems IPO filing",
        url: "newswire.example.com/orbit-systems-ipo",
        status: "accepted",
        score: 0.86,
        sources: [
          source("src-orbit-news", "https://newswire.example.com/orbit-systems-ipo", "Orbit Systems files for IPO", "The tech company filed for an IPO on Nasdaq in March 2026.", "reputable_secondary"),
        ],
        cells: {
          article_url: cell("https://newswire.example.com/orbit-systems-ipo", ["src-orbit-news"]),
          company: cell("Orbit Systems", ["src-orbit-news"]),
          announcement_date: cell("2026-03-22", ["src-orbit-news"]),
          exchange: cell("Nasdaq", ["src-orbit-news"]),
        },
        evaluations: [
          criterion("Item is a tech IPO announcement", "pass", "The article is clearly about a tech IPO filing.", ["src-orbit-news"]),
          criterion("Item is recent", "pass", "The report date is recent relative to the query intent.", ["src-orbit-news"]),
          criterion("Includes company, date, and listing exchange", "pass", "The article includes all three required details.", ["src-orbit-news"]),
        ],
      },
      {
        id: "row-lattice-market",
        name: "Lattice Market IPO speculation",
        url: "markets.example.com/lattice-market-ipo-rumors",
        status: "rejected",
        score: 0.42,
        sources: [
          source("src-lattice-rumor", "https://markets.example.com/lattice-market-ipo-rumors", "Rumors swirl around Lattice Market IPO", "An analyst note speculates on a possible future filing.", "reputable_secondary"),
        ],
        cells: {
          article_url: cell("https://markets.example.com/lattice-market-ipo-rumors", ["src-lattice-rumor"]),
          company: cell("Lattice Market", ["src-lattice-rumor"]),
          announcement_date: cell(null, ["src-lattice-rumor"], "not_found", 0.2, "date_missing"),
          exchange: cell(null, ["src-lattice-rumor"], "not_found", 0.2, "exchange_missing"),
        },
        evaluations: [
          criterion("Item is a tech IPO announcement", "fail", "The article is speculative and does not describe an actual announcement.", ["src-lattice-rumor"]),
          criterion("Item is recent", "pass", "The article itself is recent.", ["src-lattice-rumor"]),
          criterion("Includes company, date, and listing exchange", "fail", "Key filing details are missing.", ["src-lattice-rumor"]),
        ],
      },
    ],
  },
  {
    id: "ma-news-2025",
    category: "news",
    query: "News stories about M&A in 2025",
    entityType: "news_item",
    hardFilters: ["Item is about mergers or acquisitions", "Item is dated in 2025"],
    softSignals: ["Includes acquirer and target details"],
    columns: [
      { key: "article_url", label: "Article URL", kind: "identity", valueType: "url", preferredSources: ["reputable_secondary"], requiresVerification: true, allowInference: false, nullPolicy: "dash", orderIndex: 0 },
      { key: "acquirer", label: "Acquirer", kind: "enrichment", valueType: "string", preferredSources: ["reputable_secondary"], requiresVerification: true, allowInference: false, nullPolicy: "dash", orderIndex: 1 },
      { key: "target", label: "Target", kind: "enrichment", valueType: "string", preferredSources: ["reputable_secondary"], requiresVerification: true, allowInference: false, nullPolicy: "dash", orderIndex: 2 },
      { key: "date", label: "Date", kind: "enrichment", valueType: "date", preferredSources: ["reputable_secondary"], requiresVerification: true, allowInference: false, nullPolicy: "dash", orderIndex: 3 },
    ],
    searchQueries: ["M&A news 2025 company acquisition", "2025 merger acquisition business news", "2025 acquisition announcement"],
    budgets: { searchBudget: 3, fetchBudget: 9, verificationBudget: 5 },
    notes: "Use business reporting, not market rumor posts.",
    candidates: [
      {
        id: "row-northwind-acquires-echo",
        name: "Northwind acquires EchoStack",
        url: "finance.example.com/northwind-echostack-acquisition",
        status: "accepted",
        score: 0.9,
        sources: [
          source("src-northwind-ma", "https://finance.example.com/northwind-echostack-acquisition", "Northwind to acquire EchoStack", "The transaction was announced in May 2025.", "reputable_secondary"),
        ],
        cells: {
          article_url: cell("https://finance.example.com/northwind-echostack-acquisition", ["src-northwind-ma"]),
          acquirer: cell("Northwind", ["src-northwind-ma"]),
          target: cell("EchoStack", ["src-northwind-ma"]),
          date: cell("2025-05-14", ["src-northwind-ma"]),
        },
        evaluations: [
          criterion("Item is about mergers or acquisitions", "pass", "The article is explicitly about an acquisition.", ["src-northwind-ma"]),
          criterion("Item is dated in 2025", "pass", "The article date is in 2025.", ["src-northwind-ma"]),
          criterion("Includes acquirer and target details", "pass", "Both companies are named.", ["src-northwind-ma"]),
        ],
      },
      {
        id: "row-delta-merger",
        name: "DeltaCloud merger talks",
        url: "markets.example.com/deltacloud-merger-talks",
        status: "uncertain",
        score: 0.57,
        sources: [
          source("src-delta-talks", "https://markets.example.com/deltacloud-merger-talks", "DeltaCloud explores merger talks", "The report describes talks but no signed deal.", "reputable_secondary"),
        ],
        cells: {
          article_url: cell("https://markets.example.com/deltacloud-merger-talks", ["src-delta-talks"]),
          acquirer: cell("DeltaCloud", ["src-delta-talks"]),
          target: cell(null, ["src-delta-talks"], "uncertain", 0.4, "counterparty_unclear"),
          date: cell("2025-02-08", ["src-delta-talks"]),
        },
        evaluations: [
          criterion("Item is about mergers or acquisitions", "uncertain", "The report describes talks rather than a completed transaction.", ["src-delta-talks"], 0.49),
          criterion("Item is dated in 2025", "pass", "The report is from 2025.", ["src-delta-talks"]),
          criterion("Includes acquirer and target details", "uncertain", "A concrete target is not firmly identified.", ["src-delta-talks"], 0.35),
        ],
      },
    ],
  },
  {
    id: "museum-exhibitions",
    category: "news",
    query: "Museum art exhibitions in New York",
    entityType: "news_item",
    hardFilters: ["Item is about an exhibition", "Item is in New York"],
    softSignals: ["Includes dates and museum details"],
    columns: [
      { key: "museum", label: "Museum", kind: "enrichment", valueType: "string", preferredSources: ["official"], requiresVerification: true, allowInference: false, nullPolicy: "dash", orderIndex: 0 },
      { key: "exhibition", label: "Exhibition", kind: "enrichment", valueType: "string", preferredSources: ["official"], requiresVerification: true, allowInference: false, nullPolicy: "dash", orderIndex: 1 },
      { key: "dates", label: "Dates", kind: "enrichment", valueType: "string", preferredSources: ["official"], requiresVerification: true, allowInference: false, nullPolicy: "dash", orderIndex: 2 },
      { key: "listing_url", label: "Listing URL", kind: "identity", valueType: "url", preferredSources: ["official"], requiresVerification: true, allowInference: false, nullPolicy: "dash", orderIndex: 3 },
    ],
    searchQueries: ["New York museum exhibition official", "NY museum current exhibition official", "museum exhibition New York listing"],
    budgets: { searchBudget: 3, fetchBudget: 10, verificationBudget: 4 },
    notes: "Prefer official museum listing pages.",
    candidates: [
      {
        id: "row-modern-lines",
        name: "Modern Lines at City Museum",
        url: "citymuseum.example.com/exhibitions/modern-lines",
        status: "accepted",
        score: 0.87,
        sources: [
          source("src-modern-lines", "https://citymuseum.example.com/exhibitions/modern-lines", "Modern Lines", "Exhibition at City Museum in New York from April to August.", "official"),
        ],
        cells: {
          museum: cell("City Museum", ["src-modern-lines"]),
          exhibition: cell("Modern Lines", ["src-modern-lines"]),
          dates: cell("2026-04-01 to 2026-08-20", ["src-modern-lines"]),
          listing_url: cell("https://citymuseum.example.com/exhibitions/modern-lines", ["src-modern-lines"]),
        },
        evaluations: [
          criterion("Item is about an exhibition", "pass", "The page is an official exhibition listing.", ["src-modern-lines"]),
          criterion("Item is in New York", "pass", "The museum is in New York.", ["src-modern-lines"]),
          criterion("Includes dates and museum details", "pass", "Dates and venue are listed.", ["src-modern-lines"]),
        ],
      },
      {
        id: "row-light-field",
        name: "Light Field at North Gallery",
        url: "northgallery.example.com/light-field",
        status: "accepted",
        score: 0.82,
        sources: [
          source("src-light-field", "https://northgallery.example.com/light-field", "Light Field", "Current exhibition at North Gallery in Manhattan.", "official"),
        ],
        cells: {
          museum: cell("North Gallery", ["src-light-field"]),
          exhibition: cell("Light Field", ["src-light-field"]),
          dates: cell("Runs through 2026-07-15", ["src-light-field"]),
          listing_url: cell("https://northgallery.example.com/light-field", ["src-light-field"]),
        },
        evaluations: [
          criterion("Item is about an exhibition", "pass", "The page is an official exhibition page.", ["src-light-field"]),
          criterion("Item is in New York", "pass", "The venue is in Manhattan.", ["src-light-field"]),
          criterion("Includes dates and museum details", "pass", "The page includes the run-through date and venue.", ["src-light-field"]),
        ],
      },
    ],
  },
];

export function findScenario(query: string): FixtureScenario {
  const normalized = normalizeFixtureQuery(query);
  const exact = smokeScenarios.find(
    (scenario) => normalizeFixtureQuery(scenario.query) === normalized,
  );
  if (exact) return exact;

  const fuzzy = smokeScenarios.find((scenario) =>
    normalized.includes(normalizeFixtureQuery(scenario.query).split(" ")[0]),
  );

  return fuzzy ?? smokeScenarios[0];
}

export function buildCriteriaForScenario(scenario: FixtureScenario, threadId: string): Criterion[] {
  return criteriaFromScenario(scenario, threadId);
}

export function buildColumnsForScenario(scenario: FixtureScenario, threadId: string): ColumnSpec[] {
  return columns(scenario.columns, threadId);
}

export function normalizeFixtureQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}
