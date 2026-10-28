import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { LangProvider } from './i18n.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'
import { analytics } from '@heycatch/sdk'

// HeyCatch analytics. Module scope, once, in the entry file that runs on every
// page — not inside a component. The project key is a public key and is meant
// to be inlined in client code.
analytics.init({
  projectKey: 'hck_pk_hU1GLGBlJ4KMXSIPk1Bn1BGh-GGgHO4k',
  // Keep internal traffic out of the audience numbers. The flag is set by
  // App.jsx the first time an admin signs in on this browser, so it also
  // covers this browser's anonymous visits afterwards. /admin is always
  // dropped, flag or not. Dropped events never leave the page.
  beforeSend: (event) => {
    try {
      if (window.location.pathname.startsWith('/admin')) return null
      if (localStorage.getItem('dl_internal') === '1') return null
    } catch { /* storage blocked: fall through and keep the event */ }
    return event
  },
  install: {
    framework: 'vite-react',
    frameworkVersion: '18',
    agent: 'claude-code',
  },
})

// After a deploy, a tab opened before it can request a code-split chunk whose
// hashed filename no longer exists, which otherwise leaves a blank page. Vite
// fires this event for that case: reload once to pick up the new build. The
// sessionStorage flag stops a reload loop if the failure is something else.
window.addEventListener("vite:preloadError", () => {
  try {
    if (sessionStorage.getItem("chunk_reload") === "1") return;
    sessionStorage.setItem("chunk_reload", "1");
  } catch { /* storage blocked: still try one reload */ }
  window.location.reload();
});

// LangProvider sits outside App so the language choice survives every view
// change and is available to Auth.jsx, which renders before App's own tree.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <LangProvider>
        <App />
      </LangProvider>
    </ErrorBoundary>
  </React.StrictMode>
)
