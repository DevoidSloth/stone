import React from 'react'
import { createRoot } from 'react-dom/client'

import '@fontsource-variable/inter/index.css'
import '@fontsource-variable/inter/wght-italic.css'
import '@fontsource-variable/newsreader/index.css'
import '@fontsource-variable/newsreader/wght-italic.css'
import './styles/tokens.css'
import './styles/base.css'
import './styles/shell.css'
import './styles/editor.css'
import './styles/views.css'
import './styles/today.css'
import './styles/graph.css'
import './styles/notion.css'
import './styles/blocks.css'
import './styles/panels.css'

import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
