import type { Thread, SearchResult, Criterion, Enrichment, AgentStep, Source } from "./types";

const COLORS = ["hsl(220, 80%, 50%)", "hsl(142, 71%, 45%)", "hsl(38, 92%, 50%)", "hsl(280, 60%, 50%)"];

export const mockCriteria: Criterion[] = [
  { id: "c1", text: "AI engineer with professional experience", color: COLORS[0] },
  { id: "c2", text: "Located in New York", color: COLORS[1] },
  { id: "c3", text: "Demonstrated expertise in design through projects, roles, or portfolio", color: COLORS[2] },
  { id: "c4", text: "Past employment at a startup after Series-A funding round", color: COLORS[3] },
];

export const mockEnrichments: Enrichment[] = [
  { id: "e1", name: "GitHub" },
  { id: "e2", name: "Email" },
];

const mkSource = (url: string, title: string, snippet: string): Source => ({
  url,
  title,
  snippet,
  favicon: `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=16`,
  visitedAt: new Date(Date.now() - Math.random() * 60000).toISOString(),
});

export const mockResults: SearchResult[] = [
  {
    id: "1",
    name: "Andrei Butenko",
    url: "linkedin.com/in/andrebutenko",
    status: "match",
    matchScore: 4,
    sourcesVisited: [
      mkSource("https://linkedin.com/in/andrebutenko", "Andrei Butenko - LinkedIn", "Senior AI Engineer at Scale AI"),
      mkSource("https://andrebutenko.com", "Andrei Butenko - Portfolio", "Product design portfolio"),
      mkSource("https://crunchbase.com/organization/figma", "Figma - Crunchbase", "Series B startup"),
      mkSource("https://github.com/andrebutenko", "andrebutenko - GitHub", "Open source contributions"),
    ],
    evaluations: [
      { rule: "AI engineer with professional experience", passed: true, snippet: '"Senior AI Engineer at Scale AI with 5+ years of experience in ML systems"', sources: [mkSource("https://linkedin.com/in/andrebutenko", "LinkedIn Profile", "Senior AI Engineer at Scale AI")] },
      { rule: "Located in New York", passed: true, snippet: '"Based in New York, NY"', sources: [mkSource("https://linkedin.com/in/andrebutenko", "LinkedIn Profile", "New York, NY")] },
      { rule: "Demonstrated expertise in design", passed: true, snippet: '"Led product design for AI-powered dashboard used by 50k+ users"', sources: [mkSource("https://andrebutenko.com", "Portfolio", "AI dashboard design")] },
      { rule: "Past employment at a startup after Series-A", passed: true, snippet: '"Product Designer at Figma (Series B, joined 2019)"', sources: [mkSource("https://crunchbase.com/organization/figma", "Crunchbase", "Figma Series B")] },
    ],
    enrichments: {
      GitHub: { value: "github.com/andrebutenko", status: "done", source: mkSource("https://github.com/andrebutenko", "GitHub", "andrebutenko") },
      Email: { value: "andrei@butenko.dev", status: "done" },
    },
  },
  {
    id: "2",
    name: "Katie Morgan",
    url: "linkedin.com/in/katiemorgan",
    status: "match",
    matchScore: 4,
    sourcesVisited: [
      mkSource("https://linkedin.com/in/katiemorgan", "Katie Morgan - LinkedIn", "Design Lead"),
      mkSource("https://dribbble.com/katiemorgan", "Katie Morgan - Dribbble", "Award-winning design"),
      mkSource("https://crunchbase.com/organization/runwayml", "Runway ML - Crunchbase", "Series A"),
    ],
    evaluations: [
      { rule: "AI engineer with professional experience", passed: true, snippet: '"Design Lead & AI Practitioner with 8 years in the field"', sources: [mkSource("https://linkedin.com/in/katiemorgan", "LinkedIn", "AI Practitioner")] },
      { rule: "Located in New York", passed: true, snippet: '"Brooklyn, New York"', sources: [mkSource("https://linkedin.com/in/katiemorgan", "LinkedIn", "Brooklyn, NY")] },
      { rule: "Demonstrated expertise in design", passed: true, snippet: '"Award-winning design portfolio featuring AI/ML product interfaces"', sources: [mkSource("https://dribbble.com/katiemorgan", "Dribbble", "Award-winning portfolio")] },
      { rule: "Past employment at a startup after Series-A", passed: true, snippet: '"Design Lead at Runway ML (Series A, 2021)"', sources: [mkSource("https://crunchbase.com/organization/runwayml", "Crunchbase", "Runway ML Series A")] },
    ],
    enrichments: {
      GitHub: { value: "github.com/katiemorgan", status: "done" },
      Email: { value: "Extracting…", status: "extracting" },
    },
  },
  {
    id: "3",
    name: "Joseph Schmidt",
    url: "linkedin.com/in/joseph-schmidt",
    status: "verifying",
    matchScore: 1,
    sourcesVisited: [
      mkSource("https://linkedin.com/in/joseph-schmidt", "Joseph Schmidt - LinkedIn", "AI Lead"),
    ],
    evaluations: [
      { rule: "AI engineer with professional experience", passed: true, snippet: '"AI Lead | Talk about AI Solutions"', sources: [mkSource("https://linkedin.com/in/joseph-schmidt", "LinkedIn", "AI Lead")] },
      { rule: "Located in New York", passed: false, snippet: '"Currently verifying location..."', sources: [] },
      { rule: "Demonstrated expertise in design", passed: false, snippet: '"Verification in progress..."', sources: [] },
      { rule: "Past employment at a startup after Series-A", passed: false, snippet: '"Verification in progress..."', sources: [] },
    ],
    enrichments: {
      GitHub: { value: "Extracting…", status: "extracting" },
      Email: { value: "Extracting…", status: "extracting" },
    },
  },
  {
    id: "4",
    name: "Kaholie Revi",
    url: "linkedin.com/in/kaholie-revi",
    status: "miss",
    matchScore: 2,
    sourcesVisited: [
      mkSource("https://linkedin.com/in/kaholie-revi", "Kaholie Revi - LinkedIn", "AI Strategy Lead"),
      mkSource("https://crunchbase.com/organization/notion", "Notion - Crunchbase", "Series B"),
    ],
    evaluations: [
      { rule: "AI engineer with professional experience", passed: true, snippet: '"AI Strategy and Analytics Lead with 6 years experience"', sources: [mkSource("https://linkedin.com/in/kaholie-revi", "LinkedIn", "AI Strategy Lead")] },
      { rule: "Located in New York", passed: false, snippet: '"San Francisco Bay Area"', sources: [mkSource("https://linkedin.com/in/kaholie-revi", "LinkedIn", "SF Bay Area")] },
      { rule: "Demonstrated expertise in design", passed: false, snippet: '"No design-related roles or projects found in profile"', sources: [mkSource("https://linkedin.com/in/kaholie-revi", "LinkedIn", "No design roles")] },
      { rule: "Past employment at a startup after Series-A", passed: true, snippet: '"Analytics Lead at Notion (Series B, 2020)"', sources: [mkSource("https://crunchbase.com/organization/notion", "Crunchbase", "Notion Series B")] },
    ],
    enrichments: {
      GitHub: { value: "—", status: "failed" },
      Email: { value: "kaholie@notion.so", status: "done" },
    },
  },
  {
    id: "5",
    name: "Ethan M. Edwards",
    url: "linkedin.com/in/ethan-m-edwards",
    status: "match",
    matchScore: 4,
    sourcesVisited: [
      mkSource("https://linkedin.com/in/ethan-m-edwards", "Ethan Edwards - LinkedIn", "AI Engineer"),
      mkSource("https://github.com/ethanedwards", "ethanedwards - GitHub", "ML pipeline tools"),
      mkSource("https://crunchbase.com/organization/hugging-face", "Hugging Face - Crunchbase", "Series B"),
    ],
    evaluations: [
      { rule: "AI engineer with professional experience", passed: true, snippet: '"AI Engineer & Project Manager with expertise in MLOps"', sources: [mkSource("https://linkedin.com/in/ethan-m-edwards", "LinkedIn", "AI Engineer")] },
      { rule: "Located in New York", passed: true, snippet: '"Manhattan, New York"', sources: [mkSource("https://linkedin.com/in/ethan-m-edwards", "LinkedIn", "Manhattan, NY")] },
      { rule: "Demonstrated expertise in design", passed: true, snippet: '"Designed end-to-end ML pipeline visualization tools"', sources: [mkSource("https://github.com/ethanedwards", "GitHub", "ML viz tools")] },
      { rule: "Past employment at a startup after Series-A", passed: true, snippet: '"Software Engineer at Hugging Face (Series B)"', sources: [mkSource("https://crunchbase.com/organization/hugging-face", "Crunchbase", "HF Series B")] },
    ],
    enrichments: {
      GitHub: { value: "github.com/ethanedwards", status: "done" },
      Email: { value: "ethan@hf.co", status: "done" },
    },
  },
  {
    id: "6",
    name: "Dauren Mateshov",
    url: "linkedin.com/in/dauren-mateshov",
    status: "verifying",
    matchScore: 1,
    sourcesVisited: [
      mkSource("https://linkedin.com/in/dauren-mateshov", "Dauren Mateshov - LinkedIn", "AI Engineer"),
    ],
    evaluations: [
      { rule: "AI engineer with professional experience", passed: true, snippet: '"AI Engineer - Generative AI"', sources: [mkSource("https://linkedin.com/in/dauren-mateshov", "LinkedIn", "GenAI Engineer")] },
      { rule: "Located in New York", passed: false, snippet: '"Verifying location data..."', sources: [] },
      { rule: "Demonstrated expertise in design", passed: false, snippet: '"Verification in progress..."', sources: [] },
      { rule: "Past employment at a startup after Series-A", passed: false, snippet: '"Verification in progress..."', sources: [] },
    ],
    enrichments: {
      GitHub: { value: "Extracting…", status: "extracting" },
      Email: { value: "Extracting…", status: "extracting" },
    },
  },
];

export const mockAgentSteps: AgentStep[] = [
  {
    id: "s1", type: "rewrite", agent: "Rewriter", title: "Parsing natural language query",
    detail: 'Decomposing "AI engineers in new york that are great at design and have worked at a post Series-A startup" into structured criteria.',
    timestamp: Date.now() - 120000, status: "done",
    toolCalls: [{ name: "parse_query", input: '{"query": "AI engineers in new york..."}', output: '{"criteria": ["AI engineer", "New York", "design expertise", "post Series-A"]}' }],
  },
  {
    id: "s2", type: "search", agent: "Search", title: "Searching LinkedIn profiles",
    detail: "Querying LinkedIn for AI engineers matching initial criteria in the New York area.",
    timestamp: Date.now() - 100000, status: "done",
    toolCalls: [
      { name: "web_search", input: '{"query": "AI engineer New York LinkedIn"}', output: '{"results": 247}' },
      { name: "filter_results", input: '{"criteria": "location:NY"}', output: '{"filtered": 89}' },
    ],
  },
  {
    id: "s3", type: "evaluate", agent: "Evaluator", title: "Evaluating candidates against criteria",
    detail: "Checking each candidate's profile against all 4 criteria rules using source verification.",
    timestamp: Date.now() - 60000, status: "done",
    toolCalls: [{ name: "evaluate_batch", input: '{"candidates": 6, "criteria": 4}', output: '{"matches": 3, "misses": 1, "pending": 2}' }],
  },
  {
    id: "s4", type: "extract", agent: "Extractor", title: "Extracting enrichment data",
    detail: "Pulling GitHub profiles and email addresses from discovered sources.",
    timestamp: Date.now() - 30000, status: "running",
    toolCalls: [{ name: "extract_field", input: '{"field": "GitHub", "sources": ["linkedin", "google"]}' }],
  },
  {
    id: "s5", type: "reasoning", agent: "Evaluator", title: "Re-evaluating Joseph Schmidt",
    detail: 'Checking additional sources for location data. Found a conference talk mention: "Joseph Schmidt presenting at NYC AI Meetup" — need to verify if this indicates residency.',
    timestamp: Date.now() - 10000, status: "running",
  },
];

export const mockThread: Thread = {
  id: "t1",
  query: "AI engineers in new york that are great at design and have worked at a post Series-A startup",
  phase: "complete",
  criteria: mockCriteria,
  enrichments: mockEnrichments,
  results: mockResults,
  agentSteps: mockAgentSteps,
  targetResults: 25,
  createdAt: Date.now() - 300000,
  updatedAt: Date.now() - 10000,
};

export const mockThreads: Thread[] = [
  mockThread,
  {
    id: "t2",
    query: "YC W24 batch companies building in healthcare",
    phase: "complete",
    criteria: [
      { id: "c1", text: "Y Combinator W24 batch", color: COLORS[0] },
      { id: "c2", text: "Healthcare or biotech focus", color: COLORS[1] },
    ],
    enrichments: [],
    results: [],
    agentSteps: [],
    targetResults: 50,
    createdAt: Date.now() - 86400000,
    updatedAt: Date.now() - 86400000,
  },
  {
    id: "t3",
    query: "Open source LLM projects with >1k GitHub stars",
    phase: "preview",
    criteria: [
      { id: "c1", text: "Open source project", color: COLORS[0] },
      { id: "c2", text: "Related to LLMs or language models", color: COLORS[1] },
      { id: "c3", text: "More than 1000 GitHub stars", color: COLORS[2] },
    ],
    enrichments: [],
    results: [],
    agentSteps: [],
    targetResults: 25,
    createdAt: Date.now() - 172800000,
    updatedAt: Date.now() - 172800000,
  },
];
