import { useEffect, useRef } from 'react'

// El lector Zebra TC52 tipea los caracteres en ráfaga (<50ms entre teclas).
// Dispara onScan cuando llega Enter O cuando pasan 120ms sin más caracteres
// y el buffer tiene >= 4 chars (scanner sin sufijo Enter configurado).
export function useBarcodeScan(onScan: (codigo: string) => void, enabled = true) {
  const bufferRef = useRef('')
  const timerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!enabled) return

    function flush() {
      const codigo = bufferRef.current.trim()
      bufferRef.current = ''
      if (codigo.length >= 4) onScan(codigo)
    }

    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement

      // Si el foco está en un input manual, no interferir
      if (target.dataset.manual === 'true') return

      if (e.key === 'Enter') {
        if (timerRef.current) clearTimeout(timerRef.current)
        flush()
        return
      }

      if (e.key.length === 1) {
        bufferRef.current += e.key
        if (timerRef.current) clearTimeout(timerRef.current)
        // Dispara automáticamente si no llega más input en 120ms
        timerRef.current = setTimeout(flush, 120)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [onScan, enabled])
}
