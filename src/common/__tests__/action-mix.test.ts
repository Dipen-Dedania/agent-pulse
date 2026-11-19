import { describe, it, expect } from 'vitest';
import { classifyToolName, countPairedToolCalls } from '../action-mix';

describe('classifyToolName', () => {
  it('maps each agent’s own name for the same action onto one category', () => {
    // Claude Code, Grok, Antigravity, OpenCode, Copilot
    for (const n of ['Read', 'read_file', 'view_file', 'read', 'Grep', 'grep_search', 'list_dir', 'Glob']) {
      expect(classifyToolName(n), n).toBe('explore');
    }
    for (const n of ['Edit', 'Write', 'apply_patch', 'search_replace', 'write_to_file', 'multi_replace_file_content', 'create_file']) {
      expect(classifyToolName(n), n).toBe('edit');
    }
    for (const n of ['Bash', 'PowerShell', 'Shell', 'run_command', 'run_terminal_command', 'run_in_terminal']) {
      expect(classifyToolName(n), n).toBe('shell');
    }
    for (const n of ['WebFetch', 'WebSearch', 'web_search', 'search_web', 'read_url_content', 'webrun']) {
      expect(classifyToolName(n), n).toBe('web');
    }
    for (const n of ['Agent', 'Task', 'task', 'invoke_subagent', 'Workflow']) {
      expect(classifyToolName(n), n).toBe('delegate');
    }
    for (const n of ['TodoWrite', 'todo_write', 'todowrite', 'update_plan', 'ExitPlanMode', 'AskUserQuestion', 'request_user_input_async']) {
      expect(classifyToolName(n), n).toBe('plan');
    }
  });

  it('treats every MCP tool as MCP, whatever its own name says', () => {
    expect(classifyToolName('mcp__chrome-devtools__take_screenshot')).toBe('mcp');
    expect(classifyToolName('mcp__files__read')).toBe('mcp');
    expect(classifyToolName('MCP:firecrawl_search')).toBe('mcp');
  });

  it('falls back to other for names it does not know', () => {
    expect(classifyToolName('ToolSearch')).toBe('other');
    expect(classifyToolName('')).toBe('other');
    expect(classifyToolName('constructor')).toBe('other');
    // Only an exact name matches — no substring guessing.
    expect(classifyToolName('get_command_or_subagent_output')).toBe('other');
  });
});

describe('countPairedToolCalls', () => {
  const row = (sessionId: string, name: string) => ({ sessionId, name });

  it('counts a before/after pair as one call', () => {
    const counts = countPairedToolCalls([
      row('s1', 'view_file'), row('s1', 'view_file'),
      row('s1', 'run_command'), row('s1', 'run_command'),
    ]);
    expect(Object.fromEntries(counts)).toEqual({ view_file: 1, run_command: 1 });
  });

  it('keeps back-to-back calls of the same tool as separate calls', () => {
    const counts = countPairedToolCalls([
      row('s1', 'view_file'), row('s1', 'view_file'),
      row('s1', 'view_file'), row('s1', 'view_file'),
    ]);
    expect(counts.get('view_file')).toBe(2);
  });

  it('still counts a row whose partner is missing', () => {
    const counts = countPairedToolCalls([
      row('s1', 'view_file'),
      row('s1', 'run_command'), row('s1', 'run_command'),
    ]);
    expect(Object.fromEntries(counts)).toEqual({ view_file: 1, run_command: 1 });
  });

  it('never pairs rows from different sessions', () => {
    const counts = countPairedToolCalls([row('s1', 'view_file'), row('s2', 'view_file')]);
    expect(counts.get('view_file')).toBe(2);
  });
});
