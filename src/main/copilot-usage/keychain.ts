// Reads the GitHub `gho_` OAuth token from the OS keychain — ONLY invoked when
// the user has opted into live quota (copilotUsage.liveQuota). No new native
// dependency: we shell out to the platform's credential tool.
//
// Windows (validated this session): Git Credential Manager stores the token in
// Windows Credential Manager under target `GitHub - https://api.github.com/<user>`.
// We read it via a CredRead P/Invoke in a short PowerShell snippet. The blob is
// the raw 40-byte token in UTF-8; CredRead returns it to the owning user with no
// interactive prompt. The target is passed via an env var (not interpolated into
// the script) so the username can't break out of the command.
//
// macOS / Linux: best-effort via `security` / `secret-tool`. These degrade
// cleanly (return {ok:false}) when the entry isn't found, so the poller falls
// back to a clear "sign in" / "unavailable" state rather than crashing.
//
// The token is never cached — the poller re-reads each cycle (same discipline as
// the Codex/Cursor credential readers).

import { execFile } from 'child_process';

export interface TokenResult {
  ok: true;
  token: string;
}
export interface TokenError {
  ok: false;
  reason: 'missing' | 'unsupported' | 'error';
  detail: string;
}
export type TokenRead = TokenResult | TokenError;

const EXEC_TIMEOUT_MS = 10_000;
const TOKEN_RE = /\bgh[opsu]_[A-Za-z0-9]{20,}\b/;

function run(
  cmd: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { timeout: EXEC_TIMEOUT_MS, windowsHide: true, env: env ?? process.env },
      (err, stdout, stderr) => {
        const code = err && typeof (err as any).code === 'number' ? (err as any).code : err ? 1 : 0;
        resolve({ code, stdout: stdout?.toString() ?? '', stderr: stderr?.toString() ?? '' });
      },
    );
  });
}

// CredRead P/Invoke; reads target from $env:CRED_TARGET, prints the UTF-8 token.
const PS_SCRIPT = `
$ErrorActionPreference = 'Stop'
$sig = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class AgentPulseCred {
  [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  static extern bool CredRead(string target, int type, int flags, out IntPtr cred);
  [DllImport("advapi32.dll")] static extern void CredFree(IntPtr cred);
  [StructLayout(LayoutKind.Sequential)]
  struct CREDENTIAL { public int Flags; public int Type; public IntPtr TargetName; public IntPtr Comment;
    public long LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
    public int AttributeCount; public IntPtr Attributes; public IntPtr TargetAlias; public IntPtr UserName; }
  public static string Read(string target) {
    IntPtr p;
    if (!CredRead(target, 1, 0, out p)) return "";
    var c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
    byte[] bytes = new byte[c.CredentialBlobSize];
    Marshal.Copy(c.CredentialBlob, bytes, 0, c.CredentialBlobSize);
    CredFree(p);
    return Encoding.UTF8.GetString(bytes);
  }
}
'@
Add-Type -TypeDefinition $sig -Language CSharp | Out-Null
[Console]::Out.Write([AgentPulseCred]::Read($env:CRED_TARGET))
`;

async function readWindows(username: string): Promise<TokenRead> {
  const target = `GitHub - https://api.github.com/${username}`;
  // -EncodedCommand avoids all quoting issues with the multi-line script.
  const encoded = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64');
  // No -ExecutionPolicy override needed: -EncodedCommand runs the script from
  // memory, not a file, so it isn't subject to the on-disk execution policy.
  const { code, stdout, stderr } = await run(
    'powershell.exe',
    ['-NonInteractive', '-NoProfile', '-EncodedCommand', encoded],
    { ...process.env, CRED_TARGET: target },
  );
  const m = stdout.match(TOKEN_RE);
  if (m) return { ok: true, token: m[0] };
  if (code !== 0) {
    return { ok: false, reason: 'error', detail: `CredRead failed (${code}): ${stderr.slice(0, 200)}` };
  }
  return {
    ok: false,
    reason: 'missing',
    detail: `No GitHub token in Windows Credential Manager for "${username}". Sign in to GitHub in VS Code or run \`git\` against github.com.`,
  };
}

async function readMac(): Promise<TokenRead> {
  // git's osxkeychain helper / GCM store the token as an internet password for
  // github.com. Best-effort: the account name is unknown, so match on server.
  const { stdout } = await run('security', ['find-internet-password', '-s', 'github.com', '-w']);
  const m = stdout.match(TOKEN_RE);
  if (m) return { ok: true, token: m[0] };
  return { ok: false, reason: 'missing', detail: 'No github.com token found in the macOS keychain.' };
}

async function readLinux(): Promise<TokenRead> {
  // GCM / libsecret store under service=github.com. Best-effort.
  const { stdout } = await run('secret-tool', ['lookup', 'service', 'github.com']);
  const m = stdout.match(TOKEN_RE);
  if (m) return { ok: true, token: m[0] };
  return { ok: false, reason: 'missing', detail: 'No github.com token found via secret-tool.' };
}

export async function readOAuthToken(username: string): Promise<TokenRead> {
  if (!username) {
    return { ok: false, reason: 'error', detail: 'username required to locate the keychain entry' };
  }
  try {
    switch (process.platform) {
      case 'win32':
        return await readWindows(username);
      case 'darwin':
        return await readMac();
      case 'linux':
        return await readLinux();
      default:
        return { ok: false, reason: 'unsupported', detail: `keychain read unsupported on ${process.platform}` };
    }
  } catch (e: any) {
    return { ok: false, reason: 'error', detail: e?.message ?? String(e) };
  }
}
