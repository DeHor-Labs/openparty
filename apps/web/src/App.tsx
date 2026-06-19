// apps/web/src/App.tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Home } from './components/Home'
import { RoomPage } from './pages/RoomPage'
import { ThemeProvider } from './lib/ThemeContext'

export function App(): JSX.Element {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/room/:roomId" element={<RoomPage />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  )
}
