import { useEffect, useRef } from 'react'

// El lector Zebra tipea los caracteres del código y termina con Enter.
// Este hook acumula lo que llega en menos de 50ms (velocidad del scanner)
// y lo distingue de un humano escribiendo manualmente.
export function useBarcodeScan(onScan: (codigo: string) => void) {
  const bufferRef = useRef('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ignorar si el foco está en un input de cantidad
      const target = e.target as HTMLElement
      if (target.dataset.manual === 'true') return

      if (e.key === 'Enter') {
        const codigo = bufferRef.current.trim()
        if (codigo.length >= 6) onScan(codigo)
        bufferRef.current = ''
        return
      }

      if (e.key.length === 1) {
        bufferRef.current += e.key
        if (timerRef.current) clearTimeout(timerRef.current)
        // Si pasa más de 100ms entre teclas, asumimos que es escritura humana
        timerRef.current = setTimeout(() => {
          bufferRef.current = ''
        }, 100)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onScan])
}
