# 🌌 Agent Pulse

**Agent Pulse** is a lightweight, beautiful Electron desktop app that provides **ambient, glanceable awareness** of AI coding agents running across multiple tools. 

Instead of constantly switching windows or checking terminals to see if your agents are still working or have stalled, Agent Pulse provides animated, frosted-glass bubbles on your desktop that represent each of your AI tools.

## ✨ Core Features

- **Ambient Awareness**: Floating, always-on-top bubbles with a high-end **Apple Glass (Glassmorphism)** design.
- **Real-time Status**: 
  - 🔵 **Working**: Soft pulsing glow and orbiting particles.
  - ⚪ **Idle**: Calm, breathing effect.
  - 🔴 **Dead/Error**: Red glow and a "shake" animation.
- **Unified Status Bridge**: A local HTTP server that normalizes events from different tools into a single status layer.
- **One-Click Installation**: Guided setup to install hooks for supported tools.
- **Supported Tools**: Claude Code, Cursor, VS Code + GitHub Copilot, and OpenAI Codex.

## 🚀 Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+ recommended)
- [npm](https://www.npmjs.com/)

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/Dipen-Dedania/agent-pulse.git
   cd agent-pulse
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

### Running the App
Start the application in development mode:
```bash
npm start
```
*This will launch both the Vite renderer (for the UI) and the Electron main process concurrently.*

## 🛠 Technical Smoke Test

If you want to verify that the Status Bridge (the backend "brain") is working without launching the full GUI, you can run the bridge smoke test:

```bash
npx tsx src/main/test-bridge.ts
```
This test simulates incoming events from AI tools and verifies that the state manager updates correctly.

## 🏗 Architecture Overview

- **Main Process**: Handles the local HTTP bridge server, hook installation logic, and window management.
- **Renderer Process**: A React + Vite application using Tailwind CSS and Framer Motion for high-performance animations.
- **Status Bridge**: Listens on port `4242` for POST requests from tool hooks, normalizing them into a standard event schema.
- **Glassmorphism UI**: Implemented using `backdrop-filter: blur()` and semi-transparent layers to achieve the "Apple Glass" effect.

## 📁 Project Structure

- `src/main/bridge/`: The HTTP server and state management logic.
- `src/main/installer/`: Tool detection and hook writing logic.
- `src/main/windows/`: Electron window configurations for bubbles and settings.
- `src/renderer/components/Bubble/`: The visual implementation of the status indicators.
- `src/renderer/components/Settings/`: The configuration interface.
- `src/common/`: Shared TypeScript types.
