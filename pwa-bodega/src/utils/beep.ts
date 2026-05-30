let ctx: AudioContext | null = null

function getCtx(): AudioContext {
  if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
  if (ctx.state === 'suspended') ctx.resume()
  return ctx
}

function tone(freq: number, duration: number, gain = 0.4, startOffset = 0): void {
  const ac  = getCtx()
  const osc = ac.createOscillator()
  const g   = ac.createGain()
  osc.connect(g)
  g.connect(ac.destination)
  osc.frequency.value = freq
  osc.type = 'sine'
  const t = ac.currentTime + startOffset
  g.gain.setValueAtTime(gain, t)
  g.gain.exponentialRampToValueAtTime(0.001, t + duration)
  osc.start(t)
  osc.stop(t + duration + 0.05)
}

// Pitido corto y agudo — código leído
export function beepScan(): void {
  try { tone(1800, 0.08, 0.45) } catch {}
}

// Dos notas ascendentes — operación guardada con éxito
export function beepOk(): void {
  try {
    tone(880,  0.10, 0.4, 0)
    tone(1320, 0.18, 0.4, 0.11)
  } catch {}
}

// Dos notas descendentes — algo salió mal
export function beepError(): void {
  try {
    tone(440, 0.15, 0.4, 0)
    tone(280, 0.22, 0.4, 0.16)
  } catch {}
}
