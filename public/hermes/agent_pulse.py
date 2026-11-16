#!/usr/bin/env python3
"""Hermes v0.23.1 observation adapter. Runtime uses Python's standard library only."""
import hashlib
import hmac
import http.client
import json
import os
from pathlib import Path
import sys
import time

EVENTS = ('pre_llm_call', 'pre_tool_call', 'post_tool_call', 'on_session_end',
          'on_human_input_request', 'on_human_input_resolved')


def observe(namespace):
    # Never print hook data, errors, response bodies, or control directives.
    at = time.time_ns() // 1_000_000
    raw = sys.stdin.buffer.read(8 * 1024 * 1024 + 1)
    if len(raw) > 8 * 1024 * 1024:
        return
    payload = json.loads(raw)
    event = payload.get('hook_event_name')
    session = payload.get('session_id')
    if event not in EVENTS or not isinstance(session, str) or not session or len(session) > 4096:
        return
    connection = Path.home() / '.agent-pulse' / 'hermes.json'
    if connection.is_symlink():
        return
    with connection.open('rb') as config_file:
        cfg = json.loads(config_file.read(4097))
    token, port = cfg['token'], cfg['port']
    if not isinstance(port, int) or not 0 < port < 65536 or not isinstance(token, str) or len(token) != 64:
        return
    def opaque(*parts):
        return hmac.new(token.encode(), json.dumps(parts, separators=(',', ':')).encode(), hashlib.sha256).hexdigest()
    profile = payload.get('profile', '')
    if not isinstance(profile, str) or len(profile) > 4096:
        return
    body = dict(v=1, event=event, session=opaque(namespace, profile, session), at=at)
    if event.startswith('on_human_input_'):
        request = (payload.get('extra') or {}).get('request_id')
        if not isinstance(request, str) or not request or len(request) > 4096:
            return
        body['request'] = opaque(namespace, profile, session, request)
    # Fixed loopback, no proxy environment, redirects, retries or response body.
    # The outer Hermes hook timeout is 1s; each network operation caps at 200ms.
    conn = http.client.HTTPConnection('127.0.0.1', port, timeout=0.2)
    try:
        conn.request('POST', '/hermes/event', json.dumps(body),
                     {'Content-Type': 'application/json', 'X-Pulse-Token': token})
        conn.getresponse().close()
    finally:
        conn.close()


def command_line(args, windows=os.name == 'nt'):
    """Join argv the way Hermes's split_command_line splits it back.

    POSIX: shlex.split, so shlex.join. Windows: shlex.split(posix=False) and one
    layer of matching quotes stripped per token, so double-quote every token and
    refuse embedded double quotes (backslashes are literal there)."""
    if not windows:
        import shlex
        return shlex.join(args)
    if any('"' in a for a in args):
        raise ValueError('Paths containing double quotes are not supported on Windows')
    return ' '.join('"' + a + '"' for a in args)


def shell_quote(text, windows=os.name == 'nt'):
    """Quote one argument for the user's shell: PowerShell on Windows, sh elsewhere."""
    if windows:
        return "'" + text.replace("'", "''") + "'"
    import shlex
    return shlex.quote(text)


def lock_exclusive(handle):
    """Serialize concurrent runs of this helper (cannot coordinate other editors)."""
    if os.name == 'nt':
        import msvcrt
        handle.seek(0)
        msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)  # retries ~10s, then OSError
    else:
        import fcntl
        fcntl.flock(handle, fcntl.LOCK_EX)


def configure(home, remove=False):
    """Explicit manual setup; never approves a hook or executes Hermes hooks."""
    import uuid
    try:
        from ruamel.yaml import YAML
    except ImportError:
        raise SystemExit('This helper needs ruamel.yaml. Run: ' + shell_quote(sys.executable)
                         + ' -m pip install --user ruamel.yaml   then retry.')
    yaml = YAML()
    yaml.version = (1, 1)  # Match Hermes config semantics, including yes/no booleans.
    yaml.preserve_quotes = True
    yaml.allow_duplicate_keys = False
    # Hermes's launcher runs with its own import path, so hermes_cli is usually
    # not importable here. Check capabilities when it is; otherwise rely on the
    # documented minimum version (v0.23.1) and `hermes hooks doctor`.
    try:
        from hermes_cli.plugins import VALID_HOOKS, SHELL_UNSUPPORTED_HOOKS
    except ImportError:
        VALID_HOOKS = SHELL_UNSUPPORTED_HOOKS = None
    if VALID_HOOKS is not None and not set(EVENTS) <= set(VALID_HOOKS) - set(SHELL_UNSUPPORTED_HOOKS):
        raise ValueError('Hermes lacks required shell hook capabilities')
    home = Path(home).expanduser().resolve()
    if not home.is_dir():
        raise ValueError('Profile directory must already exist')
    cfg_path = home / 'config.yaml'
    folder = home / 'agent-pulse-observer'
    if folder.is_symlink() or cfg_path.is_symlink():
        raise ValueError('Refusing symlink setup target')
    folder.mkdir(mode=0o700, exist_ok=True)
    manifest_path = folder / 'manifest.json'
    with (folder / 'setup.lock').open('a+') as lock:
        lock_exclusive(lock)
        before = cfg_path.read_bytes() if cfg_path.exists() else b''
        config = yaml.load(before) if before else {}
        if config is None:
            config = {}
        # A bare `hooks:` key parses as null and means "no hooks yet".
        if not isinstance(config, dict) or not isinstance(config.get('hooks') or {}, dict):
            raise ValueError('Expected config and hooks mappings')
        manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
        previous = manifest.get('command')
        hooks = config.get('hooks')
        if hooks is None:
            hooks = {}  # attached below only when installing
        for event in EVENTS:
            entries = hooks.get(event) or []
            if not isinstance(entries, list):
                raise ValueError('Expected hook lists; existing config left untouched')
            kept = [e for e in entries if not (isinstance(e, dict) and previous and e.get('command') == previous)]
            # Only touch keys this helper changed: a list emptied by removing our
            # own entries goes away instead of lingering as `event: []`.
            if len(kept) != len(entries):
                if kept:
                    hooks[event] = kept
                else:
                    del hooks[event]
        if not remove:
            source = Path(__file__).read_bytes()
            digest = hashlib.sha256(source).hexdigest()
            target = folder / ('observer-' + digest + '.py')
            if not target.exists():
                with target.open('xb') as out:
                    out.write(source)
                target.chmod(0o700)
            elif target.read_bytes() != source:
                raise ValueError('Adapter content mismatch')
            namespace = manifest.get('namespace') or uuid.uuid4().hex
            # The observer itself is stdlib-only, so the interpreter running this
            # setup is a valid hook runtime; it must stay installed afterwards.
            command = command_line([sys.executable, str(target), '--observe', namespace])
            for event in EVENTS:
                if hooks.get(event) is None:
                    hooks[event] = []
                hooks[event].append({'command': command, 'timeout': 1, 'fail_closed': False})
            if config.get('hooks') is None:
                config['hooks'] = hooks
            manifest = {'namespace': namespace, 'command': command}
        if before != (cfg_path.read_bytes() if cfg_path.exists() else b''):
            raise ValueError('Config changed during setup; retry')
        backup = folder / ('config-' + str(time.time_ns()) + '.backup')
        with backup.open('xb') as out:
            os.chmod(backup, 0o600)
            out.write(before)
        temp = folder / 'config.tmp'
        with temp.open('w', encoding='utf-8', newline='') as out:
            os.chmod(temp, 0o600)
            yaml.dump(config, out)
        os.replace(temp, cfg_path)
        if not remove:
            manifest_path.write_text(json.dumps(manifest))
            manifest_path.chmod(0o600)
        print('Removed observer entries.' if remove else 'Configured observer. Consent NOT granted. Restart Hermes and approve only these observer commands individually.')
        print('Run hermes hooks doctor with this profile selected. Backup retained in agent-pulse-observer.')
        if remove and previous:
            print('To remove only its old consent, run: hermes hooks revoke ' + shell_quote(previous))


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--observe':
        try:
            observe(sys.argv[2])
        except BaseException:
            pass  # All telemetry failures are silent and fail open, exit 0.
    else:
        import argparse
        parser = argparse.ArgumentParser(description=__doc__)
        modes = parser.add_mutually_exclusive_group(required=True)
        modes.add_argument('--install', action='store_true')
        modes.add_argument('--uninstall', action='store_true')
        parser.add_argument('--home', required=True)
        args = parser.parse_args()
        try:
            configure(args.home, args.uninstall)
        except (ValueError, OSError) as error:
            # Setup refusals are expected outcomes, not crashes: one clear line.
            raise SystemExit('Agent Pulse setup failed: ' + str(error))
