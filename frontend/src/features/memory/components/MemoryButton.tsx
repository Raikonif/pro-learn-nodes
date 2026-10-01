import { useMemoryStore } from '../memory-store'

/** Opens the memory panel from the workspace header, beside agent settings. */
function MemoryButton() {
  const openPanel = useMemoryStore((s) => s.openPanel)
  const waiting = useMemoryStore((s) => s.pending.length)

  return (
    <button
      type="button"
      onClick={openPanel}
      aria-label="Memory"
      className="rounded border border-gray-300 bg-white px-2 py-0.5 text-xs font-medium text-gray-700 hover:bg-gray-100"
    >
      Memory
      {waiting > 0 ? (
        <span className="ml-1 rounded-full bg-indigo-100 px-1.5 text-[10px] font-semibold text-indigo-800">
          {waiting}
        </span>
      ) : null}
    </button>
  )
}

export default MemoryButton
