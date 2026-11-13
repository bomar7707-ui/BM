import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { LOGO_DATA_URL } from './assets/logoDataUrl';

// Ensure browser tab favicon and mobile apple-touch-icon always resolve even on GitHub Pages subpaths
if (typeof document !== 'undefined') {
  const iconLinks = document.querySelectorAll<HTMLLinkElement>(
    'link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]'
  );
  iconLinks.forEach((link) => {
    if (link.type !== 'image/svg+xml') {
      link.href = LOGO_DATA_URL;
    }
  });
}

createRoot(document.getElementById('root')!).render(<App />);
