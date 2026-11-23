import { describe, expect, it } from 'vitest';
import {
  BUILTIN_COMMANDS,
  canonicalCommand,
  classifyCommand,
  countsInline,
  DiscoveredSource,
  editDistance,
  isCommandName,
  suggestCommand,
} from '../claude-commands';

const found = (entries: Array<[string, DiscoveredSource]>) => new Map<string, DiscoveredSource>(entries);

describe('claude-commands — registry', () => {
  it('folds aliases into the main command', () => {
    expect(canonicalCommand('new')).toBe('clear');
    expect(canonicalCommand('reset')).toBe('clear');
    expect(canonicalCommand('quit')).toBe('exit');
    expect(canonicalCommand('settings')).toBe('config');
    expect(canonicalCommand('continue')).toBe('resume');
    expect(canonicalCommand('rc')).toBe('remote-control');
    expect(canonicalCommand('review')).toBe('code-review');
    expect(canonicalCommand('cost')).toBe('usage');
    expect(canonicalCommand('undo')).toBe('rewind');
    expect(canonicalCommand('bg')).toBe('background');
    expect(canonicalCommand('share')).toBe('bug');
    expect(canonicalCommand('model')).toBe('model');
    expect(canonicalCommand('not-a-command')).toBe('not-a-command');
  });

  it('no alias is also a main command', () => {
    for (const [, def] of BUILTIN_COMMANDS) {
      for (const alias of def.aliases) expect(BUILTIN_COMMANDS.has(alias)).toBe(false);
    }
  });

  it('classifies built-ins, aliases and removed commands as built-in', () => {
    expect(classifyCommand('model')).toBe('builtin');
    expect(classifyCommand('new')).toBe('builtin');
    expect(classifyCommand('vim')).toBe('builtin');           // removed, not a typo
    expect(classifyCommand('simplify')).toBe('builtin');      // bundled skill
  });

  it('classifies discovered, plugin-shaped and unknown names', () => {
    const discovered = found([['hard', 'custom'], ['brag', 'plugin']]);
    expect(classifyCommand('hard', discovered)).toBe('custom');
    expect(classifyCommand('brag', discovered)).toBe('plugin');
    expect(classifyCommand('anthropic-skills:repo-ready')).toBe('plugin');
    expect(classifyCommand('mcp__server__prompt')).toBe('plugin');
    expect(classifyCommand('nre', discovered)).toBe('unknown');
  });

  it('a core built-in wins over a user command of the same name; a user skill replaces a bundled one', () => {
    expect(classifyCommand('model', found([['model', 'custom']]))).toBe('builtin');
    expect(classifyCommand('simplify', found([['simplify', 'custom']]))).toBe('custom');
  });

  it('counts inline mentions only for own and plugin commands', () => {
    const discovered = found([['hard', 'custom'], ['brag', 'plugin']]);
    expect(countsInline('hard', discovered)).toBe(true);
    expect(countsInline('brag', discovered)).toBe(true);
    expect(countsInline('server:prompt', discovered)).toBe(true);
    expect(countsInline('login', discovered)).toBe(false);    // "fix the /login route"
    expect(countsInline('mcp', discovered)).toBe(false);
    expect(countsInline('me', discovered)).toBe(false);
  });

  it('accepts command names and rejects path-like tokens', () => {
    expect(isCommandName('model')).toBe(true);
    expect(isCommandName('anthropic-skills:repo-ready')).toBe(true);
    expect(isCommandName('mcp__a__b')).toBe(true);
    expect(isCommandName('Users/x')).toBe(false);
    expect(isCommandName('1st')).toBe(false);
    expect(isCommandName('')).toBe(false);
    expect(isCommandName('a'.repeat(65))).toBe(false);
  });
});

describe('claude-commands — typo suggestions', () => {
  it('counts a swapped pair as one edit', () => {
    expect(editDistance('claer', 'clear')).toBe(1);
    expect(editDistance('mew', 'new')).toBe(1);
    expect(editDistance('nre', 'new')).toBe(2);
    expect(editDistance('same', 'same')).toBe(0);
  });

  it('suggests the nearest command', () => {
    expect(suggestCommand('mew')).toBe('new');
    expect(suggestCommand('nwq')).toBe('new');
    expect(suggestCommand('claer')).toBe('clear');
    expect(suggestCommand('modle')).toBe('model');
  });

  it('breaks ties by usage, then by first letter', () => {
    // nre is 2 away from new, rc and ide.
    expect(suggestCommand('nre')).toBe('new');                                         // same first letter
    expect(suggestCommand('nre', new Map(), new Map([['rc', 5]]))).toBe('rc');         // most used
    expect(suggestCommand('nre', new Map(), new Map([['rc', 5], ['new', 9]]))).toBe('new');
  });

  it('suggests a discovered command', () => {
    expect(suggestCommand('hrad', found([['hard', 'custom']]))).toBe('hard');
  });

  it('returns null when nothing is close, for very short names, and for plugin-shaped names', () => {
    expect(suggestCommand('install-release')).toBeNull();
    expect(suggestCommand('zz')).toBeNull();
    expect(suggestCommand('server:promt')).toBeNull();
  });

  it('never suggests a removed command', () => {
    expect(suggestCommand('vin')).not.toBe('vim');
  });
});
