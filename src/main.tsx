import {createRoot} from 'react-dom/client';
import App from './App';
import './index.css';
import { I18nProvider } from './i18n';
import { performanceMonitor } from './services/performanceMonitor';

if (typeof window !== 'undefined') {
  const startRum = () => performanceMonitor.start();
  if ('requestIdleCallback' in window) {
    (window as any).requestIdleCallback(startRum, { timeout: 1500 });
  } else {
    setTimeout(startRum, 200);
  }
}

createRoot(document.getElementById('root')!).render(
  <I18nProvider>
    <App />
  </I18nProvider>
);
