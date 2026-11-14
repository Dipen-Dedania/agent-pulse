"""Adapter contract/setup tests; run with the supported Hermes Python + PYTHONPATH."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hermes_yaml as yaml

SCRIPT = Path(__file__).resolve().parents[2] / 'public/hermes/agent_pulse.py'
class AdapterTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='pulse-adapter-')
        self.home = Path(self.tmp.name)
        self.profile = self.home / '.hermes'; self.profile.mkdir()
        self.env = dict(os.environ, HOME=str(self.home), HERMES_HOME=str(self.profile))
    def tearDown(self):
        self.tmp.cleanup()
    def setup(self, remove=False):
        return subprocess.run([sys.executable, str(SCRIPT), '--uninstall' if remove else '--install', '--home', str(self.profile)], env=self.env, capture_output=True, timeout=10)
    def observe(self, payload, namespace='test-install'):
        return subprocess.run([sys.executable, str(SCRIPT), '--observe', namespace], input=json.dumps(payload), text=True, env=self.env, capture_output=True, timeout=2)
    def test_preserves_config_and_consent_idempotently(self):
        config = self.profile / 'config.yaml'
        config.write_text('# keep comment\nmodel: test\ncustom: yes\nhooks:\n  pre_llm_call:\n    - command: /existing/foreign\n  outbound: []\n')
        consent = self.profile / 'shell-hooks-allowlist.json'; consent.write_text('{"approvals":[]}')
        for _ in range(2):
            self.assertEqual(self.setup().returncode, 0)
        result = yaml.safe_load(config.read_text())
        self.assertIs(result['custom'], True)
        self.assertIn('# keep comment', config.read_text())
        self.assertEqual(len(result['hooks']['pre_llm_call']), 2)
        self.assertEqual(result['hooks']['outbound'], [])
        self.assertEqual(consent.read_text(), '{"approvals":[]}')
        self.assertEqual(self.setup(True).returncode, 0)
        self.assertEqual(yaml.safe_load(config.read_text())['hooks']['pre_llm_call'], [{'command': '/existing/foreign'}])
        self.assertEqual(consent.read_text(), '{"approvals":[]}')
    def test_invalid_config_is_not_overwritten(self):
        for text in ['hooks: bad\n', 'hooks:\n  pre_llm_call: bad\n', 'model: a\nmodel: b\n']:
            config = self.profile / 'config.yaml'; config.write_text(text)
            self.assertNotEqual(self.setup().returncode, 0)
            self.assertEqual(config.read_text(), text)
    def test_metadata_only_and_profile_request_correlations(self):
        seen = []
        class Receiver(BaseHTTPRequestHandler):
            def do_POST(self):
                seen.append((self.path, self.headers['X-Pulse-Token'], json.loads(self.rfile.read(int(self.headers['Content-Length'])))))
                self.send_response(204); self.end_headers()
            def log_message(self, *args): pass
        server = ThreadingHTTPServer(('127.0.0.1', 0), Receiver)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        folder = self.home / '.agent-pulse'; folder.mkdir()
        (folder / 'hermes.json').write_text(json.dumps({'port': server.server_port, 'token': 'a'*64}))
        p = {'hook_event_name': 'on_human_input_request', 'session_id': 'raw-session', 'profile': 'first',
             'cwd': '/private/project', 'tool_input': {'password': 'secret'}, 'extra': {'request_id': 'raw-request', 'prompt': 'PRIVATE', 'conversation_history': ['PRIVATE']}}
        try:
            for name, profile in [('on_human_input_request','first'), ('on_human_input_resolved','first'), ('on_human_input_request','second')]:
                p.update(hook_event_name=name, profile=profile)
                result = self.observe(p)
                self.assertEqual((result.returncode, result.stdout, result.stderr), (0, '', ''))
            self.assertEqual(len(seen), 3)
            self.assertEqual(seen[0][2]['request'], seen[1][2]['request'])
            self.assertEqual(seen[0][2]['session'], seen[1][2]['session'])
            self.assertNotEqual(seen[0][2]['session'], seen[2][2]['session'])
            for route, token, body in seen:
                self.assertEqual(route, '/hermes/event'); self.assertEqual(token, 'a'*64)
                self.assertEqual(set(body), {'v','event','session','at','request'})
                for raw in ['raw-session','raw-request','PRIVATE','password','/private/project']:
                    self.assertNotIn(raw, json.dumps(body))
        finally:
            server.shutdown(); server.server_close()
    def test_missing_pulse_and_malformed_payload_fail_open(self):
        for payload in [{}, None, {'hook_event_name':'pre_llm_call','session_id':'s'}]:
            result = self.observe(payload)
            self.assertEqual((result.returncode, result.stdout, result.stderr), (0, '', ''))
    def test_unresponsive_pulse_is_bounded(self):
        class Slow(BaseHTTPRequestHandler):
            def do_POST(self): time.sleep(.8)
            def log_message(self, *args): pass
        server = ThreadingHTTPServer(('127.0.0.1', 0), Slow)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        folder = self.home / '.agent-pulse'; folder.mkdir()
        (folder / 'hermes.json').write_text(json.dumps({'port':server.server_port,'token':'a'*64}))
        try:
            start=time.monotonic(); result=self.observe({'hook_event_name':'pre_llm_call','session_id':'s'})
            self.assertLess(time.monotonic()-start, .7)
            self.assertEqual((result.returncode,result.stdout,result.stderr),(0,'',''))
        finally:
            server.shutdown(); server.server_close()

if __name__ == '__main__': unittest.main()
