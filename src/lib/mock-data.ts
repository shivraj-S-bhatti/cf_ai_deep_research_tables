export type SearchStatus = "match" | "miss" | "verifying";

export type CriteriaEval = {
  rule: string;
  passed: boolean;
  snippet: string;
  source: string;
  sourceUrl: string;
};

export type SearchResult = {
  id: string;
  name: string;
  url: string;
  status: SearchStatus;
  evaluations: CriteriaEval[];
  [key: string]: unknown;
};

export type SearchCriterion = {
  id: string;
  text: string;
};

export const mockCriteria: SearchCriterion[] = [
  { id: "1", text: "AI engineer with professional experience" },
  { id: "2", text: "Located in New York" },
  { id: "3", text: "Demonstrated expertise in design through projects, roles, or portfolio" },
  { id: "4", text: "Past employment at a startup after Series-A funding round" },
];

export const mockResults: SearchResult[] = [
  {
    id: "1",
    name: "Andrei Butenko",
    url: "linkedin.com/in/andrebutenko",
    status: "match",
    evaluations: [
      { rule: "AI engineer with professional experience", passed: true, snippet: '"Senior AI Engineer at Scale AI with 5+ years of experience in ML systems"', source: "LinkedIn", sourceUrl: "https://linkedin.com/in/andrebutenko" },
      { rule: "Located in New York", passed: true, snippet: '"Based in New York, NY"', source: "LinkedIn", sourceUrl: "https://linkedin.com/in/andrebutenko" },
      { rule: "Demonstrated expertise in design", passed: true, snippet: '"Led product design for AI-powered dashboard used by 50k+ users"', source: "Portfolio", sourceUrl: "https://andrebutenko.com" },
      { rule: "Past employment at a startup after Series-A", passed: true, snippet: '"Product Designer at Figma (Series B, joined 2019)"', source: "Crunchbase", sourceUrl: "https://crunchbase.com/organization/figma" },
    ],
  },
  {
    id: "2",
    name: "Katie Morgan",
    url: "linkedin.com/in/katiemorgan",
    status: "match",
    evaluations: [
      { rule: "AI engineer with professional experience", passed: true, snippet: '"Design Lead & AI Practitioner with 8 years in the field"', source: "LinkedIn", sourceUrl: "https://linkedin.com/in/katiemorgan" },
      { rule: "Located in New York", passed: true, snippet: '"Brooklyn, New York"', source: "LinkedIn", sourceUrl: "https://linkedin.com/in/katiemorgan" },
      { rule: "Demonstrated expertise in design", passed: true, snippet: '"Award-winning design portfolio featuring AI/ML product interfaces"', source: "Dribbble", sourceUrl: "https://dribbble.com/katiemorgan" },
      { rule: "Past employment at a startup after Series-A", passed: true, snippet: '"Design Lead at Runway ML (Series A, 2021)"', source: "Crunchbase", sourceUrl: "https://crunchbase.com/organization/runwayml" },
    ],
  },
  {
    id: "3",
    name: "Joseph Schmidt",
    url: "linkedin.com/in/joseph-schmidt",
    status: "verifying",
    evaluations: [
      { rule: "AI engineer with professional experience", passed: true, snippet: '"AI Lead | Talk about AI Solutions"', source: "LinkedIn", sourceUrl: "https://linkedin.com/in/joseph-schmidt" },
      { rule: "Located in New York", passed: false, snippet: '"Currently verifying location..."', source: "Pending", sourceUrl: "#" },
      { rule: "Demonstrated expertise in design", passed: false, snippet: '"Verification in progress..."', source: "Pending", sourceUrl: "#" },
      { rule: "Past employment at a startup after Series-A", passed: false, snippet: '"Verification in progress..."', source: "Pending", sourceUrl: "#" },
    ],
  },
  {
    id: "4",
    name: "Kaholie Revi",
    url: "linkedin.com/in/kaholie-revi",
    status: "miss",
    evaluations: [
      { rule: "AI engineer with professional experience", passed: true, snippet: '"AI Strategy and Analytics Lead with 6 years experience"', source: "LinkedIn", sourceUrl: "https://linkedin.com/in/kaholie-revi" },
      { rule: "Located in New York", passed: false, snippet: '"San Francisco Bay Area"', source: "LinkedIn", sourceUrl: "https://linkedin.com/in/kaholie-revi" },
      { rule: "Demonstrated expertise in design", passed: false, snippet: '"No design-related roles or projects found in profile"', source: "LinkedIn", sourceUrl: "https://linkedin.com/in/kaholie-revi" },
      { rule: "Past employment at a startup after Series-A", passed: true, snippet: '"Analytics Lead at Notion (Series B, 2020)"', source: "Crunchbase", sourceUrl: "https://crunchbase.com/organization/notion" },
    ],
  },
  {
    id: "5",
    name: "Ethan M. Edwards",
    url: "linkedin.com/in/ethan-m-edwards",
    status: "match",
    evaluations: [
      { rule: "AI engineer with professional experience", passed: true, snippet: '"AI Engineer & Project Manager with expertise in MLOps"', source: "LinkedIn", sourceUrl: "https://linkedin.com/in/ethan-m-edwards" },
      { rule: "Located in New York", passed: true, snippet: '"Manhattan, New York"', source: "LinkedIn", sourceUrl: "https://linkedin.com/in/ethan-m-edwards" },
      { rule: "Demonstrated expertise in design", passed: true, snippet: '"Designed end-to-end ML pipeline visualization tools"', source: "GitHub", sourceUrl: "https://github.com/ethanedwards" },
      { rule: "Past employment at a startup after Series-A", passed: true, snippet: '"Software Engineer at Hugging Face (Series B)"', source: "Crunchbase", sourceUrl: "https://crunchbase.com/organization/hugging-face" },
    ],
  },
  {
    id: "6",
    name: "Dauren Mateshov",
    url: "linkedin.com/in/dauren-mateshov",
    status: "verifying",
    evaluations: [
      { rule: "AI engineer with professional experience", passed: true, snippet: '"AI Engineer - Generative AI"', source: "LinkedIn", sourceUrl: "https://linkedin.com/in/dauren-mateshov" },
      { rule: "Located in New York", passed: false, snippet: '"Verifying location data..."', source: "Pending", sourceUrl: "#" },
      { rule: "Demonstrated expertise in design", passed: false, snippet: '"Verification in progress..."', source: "Pending", sourceUrl: "#" },
      { rule: "Past employment at a startup after Series-A", passed: false, snippet: '"Verification in progress..."', source: "Pending", sourceUrl: "#" },
    ],
  },
];
