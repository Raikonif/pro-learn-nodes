function App() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-gray-900 mb-2">Learn Nodes</h1>
        <p className="text-gray-500 text-sm">Phase 1 — Project Skeleton</p>
        <div className="mt-6 p-4 bg-white rounded-lg shadow-sm border border-gray-200">
          <p className="text-gray-700 text-sm">
            Backend status:{' '}
            <span id="backend-status" className="inline-block w-2 h-2 rounded-full bg-gray-400 align-middle mr-1" />
            <span id="backend-message">checking...</span>
          </p>
        </div>
      </div>
    </div>
  )
}

export default App
