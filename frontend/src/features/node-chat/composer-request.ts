import { create } from 'zustand'

/**
 * Text something outside the composer asked to place in it — the practice
 * add control's "Ask the agent" — waiting for the composer to take it.
 * `seq` tells one request from the next with the same text.
 */
type ComposerRequest = { text: string; seq: number }

type ComposerRequestState = {
  request: ComposerRequest | null
  place: (text: string) => void
  consume: () => void
}

let seq = 0

export const useComposerRequest = create<ComposerRequestState>((set) => ({
  request: null,
  place: (text) => {
    seq += 1
    set({ request: { text, seq } })
  },
  consume: () => set({ request: null }),
}))

/**
 * Places `text` in the open thread's composer, focused with the cursor at the
 * end, replacing the draft. Never sends: the learner finishes the request.
 */
export function placeInComposer(text: string): void {
  useComposerRequest.getState().place(text)
}
