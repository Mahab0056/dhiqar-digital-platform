import { Component, useEffect, type ReactNode } from 'react'

/** Catches a failed chunk import or a render-time crash inside the 3D map. */
export class MapBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

/** Rendered as a boundary fallback: switches the caller to its 2D map once mounted. */
export function SwitchTo2D({ onSwitch }: { onSwitch: () => void }) {
  useEffect(() => onSwitch(), [onSwitch])
  return null
}
