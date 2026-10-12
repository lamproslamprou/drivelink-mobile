import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { LangProvider } from './i18n.jsx'
import { analytics } from '@heycatch/sdk'

// HeyCatch analytics. Module scope, once, in the entry file that runs on every
// page — not inside a component. The project key is a public key and is meant
// to be inlined in client code.
analytics.init({
  projectKey: 'hck_pk_hU1GLGBlJ4KMXSIPk1Bn1BGh-GGgHO4k',
  install: {
    framework: 'vite-react',
    frameworkVersion: '18',
    agent: 'claude-code',
  },
})

// LangProvider sits outside App so the language choice survives every view
// change and is available to Auth.jsx, which renders before App's own tree.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <LangProvider>
      <App />
    </LangProvider>
  </React.StrictMode>
)
