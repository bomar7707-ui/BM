import { createRoot } from 'react-dom/client';
import 'leaflet/dist/leaflet.css';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';
import { LOGO_DATA_URL } from './assets/logoDataUrl';

// Register PWA Service Worker for full offline shell & map tile caching
registerSW({
  immediate: true,
  onRegisterError(error) {
    console.warn('Service Worker registration warning:', error);
  },
});

// Ensure browser tab favicon always resolves reliably while preserving static apple-touch-icon PNG
if (typeof document !== 'undefined') {
  const iconLinks = document.querySelectorAll<HTMLLinkElement>(
    'link[rel="icon"], link[rel="shortcut icon"]'
  );
  iconLinks.forEach((link) => {
    if (link.type !== 'image/svg+xml') {
      link.href = LOGO_DATA_URL;
    }
  });
}

createRoot(document.getElementById('root')!).render(<App />);
