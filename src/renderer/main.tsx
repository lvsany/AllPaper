import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './workspace.css';
import './planner.css';
import { App } from './App';

// macOS draws a translucent sidebar behind the page, so the page must leave that area transparent.
if (/Mac/.test(navigator.platform)) document.documentElement.dataset.platform = 'mac';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
