import { useEffect, useId, type FormEvent, type ReactNode } from 'react'

export type DialogShellProps = {
  title: string
  onClose: () => void
  /** Submitting the form, when the dialog is one. */
  onSubmit?: (event: FormEvent) => void
  children: ReactNode
}

/**
 * The frame the project dialogs share: a backdrop over the workspace, a
 * labelled modal, and Escape or a click outside to dismiss. It overlays the
 * three panes rather than becoming a fourth.
 */
function DialogShell({ title, onClose, onSubmit, children }: DialogShellProps) {
  const headingId = useId()

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const content = (
    <>
      <h2 id={headingId} className="text-base font-semibold text-gray-900">
        {title}
      </h2>
      {children}
    </>
  )
  const className =
    'flex max-h-full w-full max-w-md flex-col gap-3 overflow-y-auto rounded-lg bg-white p-4 shadow-xl'

  return (
    <div
      data-testid="project-dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4 sm:p-8"
    >
      {onSubmit ? (
        <form
          role="dialog"
          aria-modal="true"
          aria-labelledby={headingId}
          onSubmit={onSubmit}
          className={className}
        >
          {content}
        </form>
      ) : (
        <div role="dialog" aria-modal="true" aria-labelledby={headingId} className={className}>
          {content}
        </div>
      )}
    </div>
  )
}

export default DialogShell
