import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App.tsx';
import './index.css';
import { registerSW } from 'virtual:pwa-register';
import { startAutoUpdate, registerAutoUpdateSW } from './utils/autoUpdate';

// Register Service Worker for offline PWA support
const updateSW = registerSW({
  onNeedRefresh() {
    if (confirm('Toleo jipya linapatikana. Je, unataka kusasisha?')) {
      updateSW(true);
    }
  },
  onOfflineReady() {
    console.log('App is ready to work offline');
  },
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;
    // Chrome throttles its own service-worker update check to once every 24
    // hours for an unchanged script. Ask hourly so a new build is not sitting
    // there unnoticed for a day.
    setInterval(() => { registration.update().catch(() => {}); }, 60 * 60 * 1000);
  },
});

// Hand the plugin's updater to the watcher, so applying an update goes through
// the supported path instead of a hand-rolled controllerchange wait.
registerAutoUpdateSW(updateSW);

// Watches the deployed bundle's asset hashes and reloads when they change.
startAutoUpdate();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);
