import type { Terminal } from '@xterm/xterm'

const XTERM_MOUSE_REPORTING_CLASS = 'enable-mouse-events'
const REPLAYED_WHEEL_EVENT_PROPERTY = '__orcaReplayedTerminalWheelEvent'
const DOM_DELTA_PIXEL = 0

export const TERMINAL_TUI_MOUSE_WHEEL_MULTIPLIER = 3

type TerminalWheelTarget = Pick<Terminal, 'attachCustomWheelEventHandler' | 'element'>

type ReplayedWheelEvent = WheelEvent & {
  [REPLAYED_WHEEL_EVENT_PROPERTY]?: boolean
}

function isReplayedWheelEvent(event: WheelEvent): boolean {
  return (event as ReplayedWheelEvent)[REPLAYED_WHEEL_EVENT_PROPERTY] === true
}

function markReplayedWheelEvent(event: WheelEvent): void {
  Object.defineProperty(event, REPLAYED_WHEEL_EVENT_PROPERTY, {
    configurable: true,
    value: true
  })
}

function isDiscreteWheelEvent(event: WheelEvent): boolean {
  if (event.deltaMode !== DOM_DELTA_PIXEL) {
    return true
  }

  return Math.abs(event.deltaY) >= 50
}

export function shouldMultiplyTerminalMouseWheel(
  event: WheelEvent,
  terminalElement: HTMLElement | null | undefined
): boolean {
  if (
    isReplayedWheelEvent(event) ||
    !terminalElement?.classList.contains(XTERM_MOUSE_REPORTING_CLASS) ||
    event.deltaY === 0 ||
    event.shiftKey ||
    !isDiscreteWheelEvent(event)
  ) {
    return false
  }

  return true
}

function cloneWheelEvent(event: WheelEvent): WheelEvent {
  const clone = new WheelEvent(event.type, {
    bubbles: event.bubbles,
    cancelable: event.cancelable,
    composed: event.composed,
    view: event.view,
    detail: event.detail,
    screenX: event.screenX,
    screenY: event.screenY,
    clientX: event.clientX,
    clientY: event.clientY,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    metaKey: event.metaKey,
    button: event.button,
    buttons: event.buttons,
    relatedTarget: event.relatedTarget,
    deltaX: event.deltaX,
    deltaY: event.deltaY,
    deltaZ: event.deltaZ,
    deltaMode: event.deltaMode
  })
  markReplayedWheelEvent(clone)
  return clone
}

export function attachTerminalMouseWheelMultiplier(terminal: TerminalWheelTarget): void {
  terminal.attachCustomWheelEventHandler((event) => {
    if (!shouldMultiplyTerminalMouseWheel(event, terminal.element)) {
      return true
    }

    const target =
      event.currentTarget instanceof EventTarget ? event.currentTarget : terminal.element
    if (!target) {
      return true
    }

    // Why: mouse-reporting TUIs receive wheel input as reports, not viewport
    // scrollback, so normal xterm scrollSensitivity cannot tune their speed.
    queueMicrotask(() => {
      for (let i = 1; i < TERMINAL_TUI_MOUSE_WHEEL_MULTIPLIER; i++) {
        target.dispatchEvent(cloneWheelEvent(event))
      }
    })

    return true
  })
}
