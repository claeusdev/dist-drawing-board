import { useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import './App.css'
import Whiteboard from "./components/Whiteboard.jsx"

function App() {
  const [count, setCount] = useState(0)

  return (
    <>
      <Whiteboard roomId={1} userId={Math.random()}/>
    </>
  )
}

export default App
