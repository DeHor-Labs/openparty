// apps/web/src/main.tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './App'
import { initClarity } from './lib/clarity'

const root = document.getElementById('root')
if (!root) throw new Error('#root nao encontrado')

initClarity()

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
