import { createRoot } from 'react-dom/client';
import { configureValidationForBrowser } from '@sats-wars/shared';
import { App } from './App';

// The offline demo's CSP has no 'unsafe-eval' either.
configureValidationForBrowser();
createRoot(document.getElementById('root')!).render(<App />);
