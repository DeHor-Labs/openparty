// apps/web/src/App.tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { ThemeProvider } from './lib/ThemeContext'
import { Suspense, lazy } from 'react'

const Home = lazy(() => import('./components/Home'))
const RoomPage = lazy(() => import('./components/room/RoomPage'))

export function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Suspense fallback={<div className="p-8 text-center">Carregando...</div>}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/room/:roomId" element={<RoomPage />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ThemeProvider>
  )
}
