import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/source-sans-3';
import '@fontsource-variable/source-serif-4';
import App from './App.jsx';
import AccountWorkspace from './AccountWorkspace.jsx';
import BugReport from './support/BugReport.jsx';
import './styles.css';
import './map-review.css';
import './map-studio.css';
import './ui/design-system.css';
import './workspace-layout.css';
import './notebook.css';
import './ui/control-system.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {import.meta.env.VITE_ACCOUNT_WORKSPACE === 'true' ? <><AccountWorkspace /><BugReport /></> : <App />}
  </React.StrictMode>,
);
