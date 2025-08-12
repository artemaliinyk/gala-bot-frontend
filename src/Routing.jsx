import { Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import Prison from './pages/Prison'
import ShottyPrison from './pages/Shotty/Prison.jsx'

export default function Routing() {
    return (
        <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/prison" element={<Prison />} />
            <Route path="/prison-by-shotty" element={<ShottyPrison />} />
        </Routes>
    )
}