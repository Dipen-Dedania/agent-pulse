"""One network namespace for the production bridge and real Hermes probe.
HERMES_TEST_PYTHON and HERMES_TEST_SOURCE must point to a disposable v0.23.1 install.
"""
import os
from pathlib import Path
import subprocess
import tempfile
import time
import json
import urllib.request

root = Path(__file__).resolve().parents[2]
home = Path(tempfile.mkdtemp(prefix='pulse-hermes-live-'))
(home / '.hermes').mkdir()
env = dict(os.environ, HOME=str(home), HERMES_HOME=str(home / '.hermes'),
           HERMES_RUNTIME_DIR=str(home / 'runtime'), PYTHONPATH=os.environ['HERMES_TEST_SOURCE'],
           AGENT_PULSE_LOG_LEVEL='debug')
python = os.environ['HERMES_TEST_PYTHON']
subprocess.run([python, 'public/hermes/agent_pulse.py', '--install', '--home', str(home / '.hermes')], cwd=root, env=env, check=True)
log = (home / 'bridge.log').open('w')
bridge = subprocess.Popen(['node', 'scripts/hermes/run-bridge.cjs'], cwd=root, env=env, stdout=log, stderr=log)
try:
    for _ in range(100):
        try:
            cfg = json.loads((home / '.agent-pulse/hermes.json').read_text())
            request = urllib.request.Request('http://127.0.0.1:4242/hermes/status', headers={'X-Pulse-Token': cfg['token']})
            with urllib.request.urlopen(request, timeout=.2):
                break
        except Exception:
            time.sleep(.05)
    else:
        raise RuntimeError('Bridge not listening')
    subprocess.run([python, 'scripts/hermes/live_probe.py'], cwd=root, env=env, check=True, timeout=90)
finally:
    bridge.terminate()
    bridge.wait(timeout=10)
    log.close()
subprocess.run([python, 'scripts/hermes/live_probe.py'], cwd=root, env=dict(env, PULSE_TEST_OFFLINE='1'), check=True, timeout=90)
assert 'PRIVATE_' not in (home / 'bridge.log').read_text(), 'Private data leaked to Pulse log'
assert 'TEST_OK' not in (home / 'bridge.log').read_text(), 'Output leaked to Pulse log'
assert 'synthetic-key' not in (home / 'bridge.log').read_text(), 'Credential leaked to Pulse log'
print('Pulse logs contain no prompt/output/credential canaries. Evidence directory:', home)
