// Test harness for the production compiled bridge. No mock normalization/state.
// Used where the cloud sandbox cannot create Electron's Unix-domain singleton.
const { StatusBridgeServer } = require('../../dist/main/bridge/server');
const { StatusStateManager } = require('../../dist/main/bridge/state-manager');
const { writeHermesConnection } = require('../../dist/main/bridge/hermes-connection');
const os = require('os');
const path = require('path');
// Never rotate the real user's ~/.agent-pulse/hermes.json: run-live.py points
// HOME/USERPROFILE at a temp dir, and anything else is refused.
const rel = path.relative(os.tmpdir(), os.homedir());
if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Run with HOME/USERPROFILE under the temp dir (see run-live.py)');
const manager = new StatusStateManager();
const token = writeHermesConnection(4242);
if (!token) throw new Error('Cannot publish isolated connection');
const bridge = new StatusBridgeServer(manager, { getHermesToken: () => token });
bridge.start();
const http = require('http');
// Independent actual normalized status, not merely the endpoint's session map.
const inspector = http.createServer((req, res) => {
  if (req.headers['x-pulse-token'] !== token) { res.writeHead(401); res.end(); return; }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(manager.getStatus('hermes') || null));
});
inspector.listen(4243, '127.0.0.1');
