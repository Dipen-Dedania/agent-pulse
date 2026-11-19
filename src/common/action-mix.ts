// Classifies the tool calls an agent makes ("Read", "apply_patch",
// "run_terminal_command", "mcp__server__tool") into a handful of activity
// categories, so the Agent actions card can compare agents that name the same
// action differently. Shared by the main-process query and its tests; pure.

import { ToolId } from './types';

export type ActionCategory =
  | 'explore'   // reading and searching code
  | 'edit'      // writing or patching files
  | 'shell'     // running commands
  | 'web'       // fetching pages, web search
  | 'mcp'       // any MCP server tool
  | 'delegate'  // subagents and workflows
  | 'plan'      // todo lists, plan mode, asking the user
  | 'other';

// Fixed display order (also the stacking order of the card's bar).
export const ACTION_CATEGORIES: readonly ActionCategory[] = [
  'explore', 'edit', 'shell', 'web', 'mcp', 'delegate', 'plan', 'other',
];

// Keys are tool names lowercased with every non-alphanumeric character removed,
// so "Read", "read_file" → "readfile" and "TodoWrite" / "todo_write" collapse
// onto one entry. Names seen in real hook traffic from Claude Code, Codex,
// Cursor, Copilot, Antigravity, Grok and OpenCode.
const BY_NAME: Record<string, ActionCategory> = {
  // explore
  read: 'explore', readfile: 'explore', viewfile: 'explore', viewimage: 'explore',
  grep: 'explore', grepsearch: 'explore', glob: 'explore', ls: 'explore',
  listdir: 'explore', findbyname: 'explore', filesearch: 'explore',
  codebasesearch: 'explore', semanticsearch: 'explore', notebookread: 'explore',
  // edit
  edit: 'edit', multiedit: 'edit', write: 'edit', notebookedit: 'edit',
  applypatch: 'edit', writetofile: 'edit', replacefilecontent: 'edit',
  multireplacefilecontent: 'edit', searchreplace: 'edit', createfile: 'edit',
  strreplace: 'edit', editfile: 'edit', deletefile: 'edit',
  // shell
  bash: 'shell', powershell: 'shell', shell: 'shell', exec: 'shell',
  runcommand: 'shell', runterminalcommand: 'shell', runinterminal: 'shell',
  // web
  webfetch: 'web', websearch: 'web', searchweb: 'web', readurlcontent: 'web',
  webrun: 'web', fetch: 'web',
  // delegate
  agent: 'delegate', task: 'delegate', subagenthandback: 'delegate',
  workflow: 'delegate', invokesubagent: 'delegate', managesubagents: 'delegate',
  definesubagent: 'delegate', sendmessage: 'delegate', listagents: 'delegate',
  // plan
  todowrite: 'plan', managetodolist: 'plan', updateplan: 'plan',
  taskcreate: 'plan', taskupdate: 'plan', tasklist: 'plan', taskget: 'plan',
  enterplanmode: 'plan', exitplanmode: 'plan', managetask: 'plan',
  askuserquestion: 'plan', askquestion: 'plan', question: 'plan',
  requestuserinput: 'plan', requestuserinputasync: 'plan',
  creategoal: 'plan', updategoal: 'plan', getgoal: 'plan',
};

export function classifyToolName(name: string): ActionCategory {
  // Claude Code / Codex name MCP tools "mcp__server__tool"; Cursor "MCP:tool".
  if (/^mcp(__|:)/i.test(name)) return 'mcp';
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  // Own-property check: a tool called "constructor" must not hit the prototype.
  return Object.prototype.hasOwnProperty.call(BY_NAME, key) ? BY_NAME[key] : 'other';
}

// Agents whose hooks report the tool name on BOTH the before- and after-tool
// event as a `working` row, so every call lands in the events table twice.
// (Antigravity maps PreToolUse and PostToolUse to working; Muse does the same.)
// Everyone else reports the after-event as idle, which the query filters out.
export const DOUBLE_REPORTING_AGENTS: ReadonlySet<ToolId> = new Set<ToolId>(['antigravity-cli', 'muse-code']);

/**
 * Counts tool calls per name for one double-reporting agent. `rows` must be
 * that agent's working tool rows ordered by session, then time. Each adjacent
 * same-session, same-name pair is one call (its before + after events); a row
 * left without a partner (a lost event, or the window edge) still counts once.
 */
export function countPairedToolCalls(rows: Array<{ sessionId: string | null; name: string }>): Map<string, number> {
  const counts = new Map<string, number>();
  for (let i = 0; i < rows.length; i++) {
    const cur = rows[i];
    const next = rows[i + 1];
    if (next && next.sessionId === cur.sessionId && next.name === cur.name) i++;
    counts.set(cur.name, (counts.get(cur.name) ?? 0) + 1);
  }
  return counts;
}
