import http from 'http';
import { StatusStateManager } from './bridge/state-manager';
import { StatusBridgeServer } from './bridge/server';

async function runTest() {
  console.log('🚀 Starting Status Bridge Smoke Test...');

  const stateManager = new StatusStateManager();
  const server = new StatusBridgeServer(stateManager);
  server.start();

  const testEvents = [
    { toolId: 'claude-code', state: 'working', payload: { taskSummary: 'Writing code' } },
    { toolId: 'cursor', state: 'working', payload: { activeAgents: 2 } },
    { toolId: 'claude-code', state: 'idle', payload: {} },
    { toolId: 'vscode-copilot', state: 'error', payload: { errorMessage: 'Rate limit hit' } },
  ];

  for (const event of testEvents) {
    await new Promise((resolve) => {
      const req = http.request({
        hostname: 'localhost',
        port: 4242,
        path: '/event',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }, (res) => {
        console.log(`Event [${event.toolId} -> ${event.state}]: ${res.statusCode === 200 ? '✅ SUCCESS' : '❌ FAILED'} (${res.statusCode})`);
        resolve(null);
      });

      req.on('error', (e) => {
        console.log(`Event [${event.toolId}]: ❌ ERROR ${e.message}`);
        resolve(null);
      });

      req.write(JSON.stringify(event));
      req.end();
    });
  }

  console.log('\nFinal State Check:');
  console.log(JSON.stringify(stateManager.getAllStatuses(), null, 2));

  process.exit(0);
}

runTest().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
