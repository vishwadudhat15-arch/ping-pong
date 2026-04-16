import React from 'react'
import PingPong from './components/PingPong'
import './App.css'

function App() {

  return (
    <div className="app-container">
      <main className="hero">
        <div className="game-wrapper">
          <PingPong defaultMode="ai" />
        </div>
      </main>
    </div>
  )
}

export default App
