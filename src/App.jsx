import { Link } from 'react-router-dom'
import Routing from './Routing'

export default function App() {
    return (
        <div>
            <nav>
                <Link to="/">Главная</Link> | <Link to="/prison">Prison</Link>
            </nav>
            <Routing />
        </div>
    )
}