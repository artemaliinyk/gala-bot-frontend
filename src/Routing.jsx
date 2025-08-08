import { Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import Prison from './pages/Prison'

export default function Routing() {
    return (
        <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/prison" element={<Prison />} />
        </Routes>
    )
}