import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { initThemeAttribute } from './hooks/useTheme';
import { bootMark } from './boot-marks';

// First line of the bundle: the delta from the main process's "settings
// did-finish-load" to this is script parse/evaluate time.
bootMark('renderer-module');
initThemeAttribute();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Two frames after the initial render commit is the closest proxy for "the
// real UI is on screen" available without a paint observer.
requestAnimationFrame(() => requestAnimationFrame(() => bootMark('renderer-first-frame')));
