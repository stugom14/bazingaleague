// ── Gamepad API – Standard mapping (Xbox / PS / most USB pads) ────────────
//
// Button indices (standard):
//   0  A / Cross       → Jump (Space)
//   1  B / Circle      → Crouch (ArrowDown)
//   2  X / Square      → Trick modifier (hold while jumping)
//   4  LB / L1         → (reserved)
//   5  RB / R1         → Boost release (Shift)
//   8  Select / Share  → (reserved)
//   9  Start / Options → Start / Retry
//   12 D-pad Up        → (reserved)
//   13 D-pad Down      → Crouch
//   14 D-pad Left      → Steer left
//   15 D-pad Right     → Steer right
//
// Axes:
//   0  Left stick X    → Analog steer (-1 left … +1 right)
//   1  Left stick Y    → unused
//   2  Right stick X   → unused
//   3  Right stick Y   → unused
//
// ─────────────────────────────────────────────────────────────────────────

const DEADZONE = 0.18;

// Map gamepad button index → key string (must match what skater.js checks)
const BUTTON_MAP = {
  0:  ' ',          // A / Cross → Jump
  1:  'ArrowDown',  // B / Circle → Crouch
  2:  'ArrowDown',  // X / Square → Crouch (alt)
  5:  'Shift',      // RB / R1 → Boost release
  9:  '_start',     // Start / Options → start/retry
  13: 'ArrowDown',  // D-pad Down → Crouch
  14: 'ArrowLeft',  // D-pad Left → Steer
  15: 'ArrowRight', // D-pad Right → Steer
};

let _connected = false;
let _padName = '';

// Listen for connect/disconnect
window.addEventListener('gamepadconnected', e => {
  _connected = true;
  _padName = e.gamepad.id;
  _updateIndicator(true, _padName);
  console.log(`[Gamepad] Connected: ${e.gamepad.id}`);
});

window.addEventListener('gamepaddisconnected', e => {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  _connected = Array.from(pads).some(p => p && p.connected);
  if (!_connected) _updateIndicator(false, '');
  console.log(`[Gamepad] Disconnected: ${e.gamepad.id}`);
});

// ── Per-frame poll ────────────────────────────────────────────────────────
// Call this at the start of every game loop tick.
// Mutates the `keys` object so the rest of the game just works.
export function pollGamepad(keys) {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];

  // Clear previous gamepad-injected keys so releases work correctly
  keys['_analogSteer'] = 0;

  for (const pad of pads) {
    if (!pad || !pad.connected) continue;

    // ── Buttons ──
    pad.buttons.forEach((btn, i) => {
      const key = BUTTON_MAP[i];
      if (!key) return;
      if (key === '_start') {
        // Handled separately in main.js via pollGamepadMenu()
        keys['_start'] = btn.pressed;
        return;
      }
      keys[key] = btn.pressed || btn.value > 0.5;
    });

    // ── Left stick X → analog steer ──
    const axisX = pad.axes[0];
    if (Math.abs(axisX) > DEADZONE) {
      keys['_analogSteer'] = axisX;           // -1…+1, used by skater for smooth steering
      keys['ArrowLeft']  = axisX < -DEADZONE;
      keys['ArrowRight'] = axisX >  DEADZONE;
    }

    // ── Left trigger (axis 2 on some pads, button 6 on others) → crouch ──
    const lt = pad.buttons[6];
    if (lt && lt.value > 0.3) keys['ArrowDown'] = true;

    // ── Right trigger (button 7) → boost ──
    const rt = pad.buttons[7];
    if (rt && rt.value > 0.3) keys['Shift'] = true;

    break; // only use first connected pad
  }
}

// ── Menu helper ──────────────────────────────────────────────────────────
// Returns true once (edge-triggered) when the Start / A button is pressed.
let _prevStart = false;
let _prevA     = false;
export function gamepadConfirmPressed() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const pad of pads) {
    if (!pad || !pad.connected) continue;
    const startNow = pad.buttons[9]?.pressed || false;
    const aNow     = pad.buttons[0]?.pressed || false;
    const fired = (startNow && !_prevStart) || (aNow && !_prevA);
    _prevStart = startNow;
    _prevA = aNow;
    return fired;
  }
  _prevStart = false;
  _prevA = false;
  return false;
}

export function isGamepadConnected() { return _connected; }

// ── HUD indicator ─────────────────────────────────────────────────────────
function _updateIndicator(connected, name) {
  const el = document.getElementById('gamepad-indicator');
  if (!el) return;
  if (connected) {
    const label = _guessControllerType(name);
    el.textContent = `${label} CONNECTED`;
    el.classList.remove('hidden', 'disconnected');
    el.classList.add('connected');
    // Auto-hide after 3s
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => el.classList.add('hidden'), 3000);
  } else {
    el.textContent = 'CONTROLLER DISCONNECTED';
    el.classList.remove('hidden', 'connected');
    el.classList.add('disconnected');
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => el.classList.add('hidden'), 3000);
  }
}

function _guessControllerType(id) {
  const s = id.toLowerCase();
  if (s.includes('xbox') || s.includes('xinput') || s.includes('045e')) return 'XBOX CONTROLLER';
  if (s.includes('playstation') || s.includes('dualshock') || s.includes('dualsense') || s.includes('054c')) return 'PS CONTROLLER';
  if (s.includes('nintendo') || s.includes('pro controller') || s.includes('057e')) return 'NINTENDO PRO CONTROLLER';
  return 'CONTROLLER';
}
