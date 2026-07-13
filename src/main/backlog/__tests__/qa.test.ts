import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runQa } from '../qa';

// Real temp dirs + real child processes (node -e) — the module's job is
// resolving and running commands, so mocks would test nothing.
describe('backlog qa runner', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-qa-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const writePkg = (scripts: Record<string, string>) =>
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts }));

  it("provider 'none' is skipped", async () => {
    const res = await runQa({ qaProvider: 'none', qaCommand: null }, dir);
    expect(res.verdict).toBe('skipped');
  });

  it("provider 'tests' fails as unrunnable without a test script", async () => {
    const res = await runQa({ qaProvider: 'tests', qaCommand: null }, dir);
    expect(res.verdict).toBe('failed');
    expect(res.output).toContain('no "test" script');
  });

  it("provider 'typecheck' fails as unrunnable without tsconfig or script", async () => {
    const res = await runQa({ qaProvider: 'typecheck', qaCommand: null }, dir);
    expect(res.verdict).toBe('failed');
    expect(res.output).toContain('tsconfig');
  });

  it("provider 'custom' without a command is a failed verdict", async () => {
    const res = await runQa({ qaProvider: 'custom', qaCommand: '  ' }, dir);
    expect(res.verdict).toBe('failed');
    expect(res.output).toContain('no QA command');
  });

  it("provider 'custom' passes on exit 0 and captures output", async () => {
    const res = await runQa(
      { qaProvider: 'custom', qaCommand: 'node -e "console.log(41+1)"' },
      dir,
    );
    expect(res.verdict).toBe('passed');
    expect(res.exitCode).toBe(0);
    expect(res.output).toContain('42');
  });

  it("provider 'custom' fails on non-zero exit", async () => {
    const res = await runQa(
      { qaProvider: 'custom', qaCommand: 'node -e "process.exit(3)"' },
      dir,
    );
    expect(res.verdict).toBe('failed');
    expect(res.exitCode).toBe(3);
  });

  it("provider 'tests' runs the project's npm test script", async () => {
    writePkg({ test: 'node -e "process.exit(0)"' });
    const res = await runQa({ qaProvider: 'tests', qaCommand: null }, dir);
    expect(res.verdict).toBe('passed');
    expect(res.command).toBe('npm test');
  }, 60_000);

  it('a failing npm test script yields a failed verdict', async () => {
    writePkg({ test: 'node -e "process.exit(1)"' });
    const res = await runQa({ qaProvider: 'tests', qaCommand: null }, dir);
    expect(res.verdict).toBe('failed');
  }, 60_000);
});
