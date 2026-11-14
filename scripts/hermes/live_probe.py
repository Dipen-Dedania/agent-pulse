"""Real Hermes AIAgent + shell hooks + clarify tool + production Pulse bridge.
Run only with isolated HOME/HERMES_HOME, Hermes v0.23.1 PYTHONPATH/interpreter.
No paid API, real credentials, synthetic hook events, or monkeypatches.
"""
import hashlib
import hmac
import json
import os
from pathlib import Path
import threading
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hermes_yaml as yaml
from agent import shell_hooks
from run_agent import AIAgent

home = Path(os.environ['HERMES_HOME'])
assert str(home).startswith('/tmp/'), 'Use disposable config only'
cfg = yaml.safe_load((home / 'config.yaml').read_text())
specs = shell_hooks.iter_configured_hooks(cfg)
assert len(specs) == 6
# Test fixture consent: approve these six exact commands only. Never global accept.
for spec in specs:
    assert 'agent-pulse-observer/observer-' in spec.command
    shell_hooks._record_approval(spec.event, spec.command)
assert len(shell_hooks.register_from_config(cfg)) == 6
connection = json.loads((Path.home() / '.agent-pulse/hermes.json').read_text())
observed = []
offline = os.environ.get('PULSE_TEST_OFFLINE') == '1'

def status(label, expected):
    if offline:
        observed.append({'checkpoint': label, 'transport': 'unavailable; no status assertion'})
        return
    def get(port, route):
        req = urllib.request.Request(f'http://127.0.0.1:{port}{route}', headers={'X-Pulse-Token': connection['token']})
        with urllib.request.urlopen(req, timeout=2) as response:
            return json.load(response)
    snap = get(connection['port'], '/hermes/status')
    normalized = get(4243, '/')
    assert snap['state'] == expected, (label, snap)
    assert normalized['state'] == expected, (label, normalized)
    assert normalized['activeAgents'] == snap['activeAgents']
    assert set(normalized) == {'toolId', 'state', 'lastUpdated', 'activeAgents'}
    observed.append({'checkpoint': label, 'state': normalized['state'], 'activeAgents': normalized['activeAgents']})

class Provider(BaseHTTPRequestHandler):
    def do_POST(self):
        req = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        if 'messages' not in req:
            self.send_response(404); self.end_headers(); return
        tool_done = any(m.get('role') == 'tool' for m in req['messages'])
        status('provider-after-tool' if tool_done else 'provider-before-tool', 'working')
        if tool_done:
            msg = {'role': 'assistant', 'content': 'TEST_OK'}
            finish = 'stop'
        else:
            assert any(t['function']['name'] == 'clarify' for t in req['tools'])
            msg = {'role': 'assistant', 'content': None, 'tool_calls': [{'id': 'call_fixture', 'type': 'function', 'function': {
                'name': 'clarify', 'arguments': json.dumps({'questions': [{'question': 'PRIVATE_PROMPT_CANARY', 'choices': ['Yes', 'No']}]})}}]}
            finish = 'tool_calls'
        if req.get('stream'):
            self.send_response(200); self.send_header('Content-Type', 'text/event-stream'); self.end_headers()
            delta = dict(msg)
            if 'tool_calls' in delta:
                delta['tool_calls'][0]['index'] = 0
            for d, f in [(delta, None), ({}, finish)]:
                self.wfile.write(('data: ' + json.dumps({'id': 'fixture', 'choices': [{'index': 0, 'delta': d, 'finish_reason': f}]}) + '\n\n').encode())
            self.wfile.write(b'data: [DONE]\n\n')
        else:
            raw = json.dumps({'id': 'fixture', 'choices': [{'index': 0, 'message': msg, 'finish_reason': finish}], 'usage': {'prompt_tokens': 10, 'completion_tokens': 1, 'total_tokens': 11}}).encode()
            self.send_response(200); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(raw))); self.end_headers(); self.wfile.write(raw)
    def log_message(self, *args):
        pass

srv = ThreadingHTTPServer(('127.0.0.1', 0), Provider)
threading.Thread(target=srv.serve_forever, daemon=True).start()

def clarify(questions):
    assert questions[0]['question'] == 'PRIVATE_PROMPT_CANARY'
    status('actual-clarify-wait', 'waiting')
    return {'answers': {'q0': 'Yes'}, 'outcome': 'submitted'}

agent = AIAgent(api_key='synthetic-key', base_url=f'http://127.0.0.1:{srv.server_port}/v1',
    provider='openai-compat', model='fixture', max_iterations=3, enabled_toolsets=['clarify'],
    quiet_mode=True, skip_context_files=True, skip_memory=True, save_trajectories=False,
    platform='cli', session_id='pulse-real-clarify', clarify_callback=clarify)
result = agent.run_conversation('PRIVATE_USER_CANARY', conversation_history=[], task_id='fixture-task')
assert result.get('final_response') == 'TEST_OK', result.get('final_response')
status('real-turn-complete', 'idle-active')
assert any(s['checkpoint'] == 'actual-clarify-wait' for s in observed)
if not offline:
    assert observed[-1]['activeAgents'] == 0
print(json.dumps({'result': 'PASS', 'checkpoints': observed}, indent=2))
srv.shutdown()
