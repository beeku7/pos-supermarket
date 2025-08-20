import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom'
import Cashier from './pages/Cashier'

export default function App() {
  return (
    <BrowserRouter>
      <div className="app-container" style={{ fontFamily: 'Arial, sans-serif' }}>
        <nav className="navbar" style={{ display: 'flex', gap: 12, padding: 12, background: '#333' }}>
          <Link to="/cashier" style={{ color: '#fff' }}>Cashier</Link>
        </nav>
        <Routes>
          <Route path="/cashier" element={<Cashier />} />
          <Route path="*" element={<Navigate to="/cashier" replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}
