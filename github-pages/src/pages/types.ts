import type { Cell } from '../data/comparison';
import type { PageGroup } from './links';

/**
 * Body copy is plain strings with three inline marks, rendered by
 * InlineText: `code`, **bold**, and [label](href).
 */
export interface PageSection {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
  /** Numbered steps, rendered after paragraphs/bullets */
  steps?: string[];
}

export interface PageComparisonRow {
  feature: string;
  agentPulse: Cell;
  them: Cell;
}

export interface PageComparison {
  /** Column header for the competitor */
  competitor: string;
  rows: PageComparisonRow[];
  /** Source + date line under the table, e.g. "Per tokens4breakfast.app, Oct 2026." */
  source: string;
}

export interface PageFaq {
  question: string;
  answer: string;
}

export interface SeoPage {
  slug: string;
  group: PageGroup;
  /** <title> — keep under ~60 chars, keyword first */
  title: string;
  /** Meta description — keep under ~155 chars */
  description: string;
  eyebrow: string;
  h1: string;
  lede: string;
  /** ISO date the copy was last checked against the app and competitors */
  updated: string;
  /** Optional hero screenshot (file in public/screenshots) */
  screenshot?: { file: string; alt: string };
  /** Sections before the comparison table */
  sections: PageSection[];
  comparison?: PageComparison;
  /** Sections after the comparison table (e.g. "When to pick them instead") */
  afterSections?: PageSection[];
  faq?: PageFaq[];
}
