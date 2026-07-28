import { useEffect, useState } from 'react'

function App() {
  const [backendStatus, setBackendStatus] = useState<'ok' | 'error'>('checking')

  useEffect(() => {
    fetch('http://localhost:8000/health')
      .then(res => res.ok ? setBackendStatus('ok') : setBackendStatus('error'))
      .catch(() => setBackendStatus('error'))
  }, [])

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-gray-900 mb-2">Learn Nodes</h1>
        <p className="text-gray-500 text-sm">Phase 1 — Project Skeleton</p>
        <div className="mt-6 p-4 bg-white rounded-lg shadow-sm border border-gray-200">
          <p className="text-gray-700 text-sm">
            Backend status:{' '}
            <span
              id="backend-status"
              className={`inline-block w-2 h-2 rounded-full align-middle mr-1 ${
                backendStatus === 'ok' ? 'bg-green-500' :
                backendStatus === 'error' ? 'bg-red-500' : 'bg-gray-400'
              }`}
            />
            <span id="backend-message">
              {backendStatus === 'ok' ? 'connected' :
               backendStatus === 'error' ? 'unavailable' : 'checking...'}
            </span>
          </p>
        </div>
      </div>
    </div>
  )
}

export default App
