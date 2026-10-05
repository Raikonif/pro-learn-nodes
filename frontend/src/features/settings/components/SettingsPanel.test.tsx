import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { useSettingsPanelStore } from '../settings-panel-store'
import SettingsButton from './SettingsButton'
import SettingsPanel from './SettingsPanel'
import AgentSettingsPanel from './AgentSettingsPanel'
import { useAgentsStore } from '../agents-store'

afterEach(() => {
  act(() => {
    useSettingsPanelStore.setState({ panelOpen: false })
    useAgentsStore.setState({ panelOpen: false })
  })
})

describe('Settings', () => {
  it('opens from its own header button and holds the data location', async () => {
    render(
      <>
        <SettingsButton />
        <SettingsPanel />
      </>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))

    const dialog = await screen.findByRole('dialog', { name: 'Settings' })
    expect(dialog).toContainElement(await screen.findByRole('region', { name: 'Data location' }))
  })

  it('closes on Escape', async () => {
    act(() => useSettingsPanelStore.getState().openPanel())
    render(<SettingsPanel />)
    await screen.findByRole('dialog', { name: 'Settings' })

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull()
  })

  it('is no longer buried at the bottom of the agents panel', async () => {
    act(() => useAgentsStore.setState({ panelOpen: true, load: async () => {} }))
    render(<AgentSettingsPanel />)

    await screen.findByRole('dialog', { name: 'Agents' })
    expect(screen.queryByRole('region', { name: 'Data location' })).toBeNull()
  })
})
