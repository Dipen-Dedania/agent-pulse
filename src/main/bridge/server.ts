import http from 'http';
import { StatusStateManager } from './state-manager';
import { ToolId, AgentState } from '../../common/types';

export class StatusBridgeServer {
  private server: http.Server;
  private stateManager: StatusStateManager;
  private port: number = 4242;

  constructor(stateManager: StatusStateManager) {
    this.stateManager = stateManager;
    this.server = http.createServer((req, res) => this.handleRequest(req, res));
  }

  public start() {
    this.server.listen(this.port, () => {
      console.log(`Status Bridge running on port ${this.port}`);
    });
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    if (req.method === 'POST' && req.url === '/event') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          const { toolId, state, payload } = data;

          console.log(`Bridge received event: ${toolId} -> ${state}`);

          if (this.isValidEvent(toolId, state)) {
            this.stateManager.updateStatus(toolId, state, payload);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok' }));
          } else {
            console.warn(`Invalid event data received: ${JSON.stringify(data)}`);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid event data' }));
          }
        } catch (e) {
          console.error(`JSON parse error: ${e}`);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  }

  private isValidEvent(toolId: any, state: any): boolean {
    const validTools: ToolId[] = ['claude-code', 'cursor', 'vscode-copilot', 'openai-codex'];
    const validStates: AgentState[] = ['working', 'idle', 'error'];
    return validTools.includes(toolId) && validStates.includes(state);
  }
}
