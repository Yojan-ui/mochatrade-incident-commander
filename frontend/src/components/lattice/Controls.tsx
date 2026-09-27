import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

/**
 * Damped orbit controls. Zoom is off so the wheel keeps scrolling the page;
 * auto-rotate pauses while the user drags and resumes after a short idle.
 */
export function Controls({ autoRotate }: { autoRotate: boolean }) {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const width = useThree((s) => s.size.width)
  const controls = useMemo(() => new OrbitControls(camera, gl.domElement), [camera, gl])

  useEffect(() => {
    Object.assign(controls, {
      enableDamping: true,
      dampingFactor: 0.06,
      enablePan: false,
      enableZoom: false,
      rotateSpeed: 0.55,
      autoRotate,
      autoRotateSpeed: 0.35,
      minPolarAngle: 0.35,
      maxPolarAngle: Math.PI - 0.6,
    })
    let idle: number | undefined
    const start = () => {
      window.clearTimeout(idle)
      controls.autoRotate = false
    }
    const end = () => {
      idle = window.setTimeout(() => (controls.autoRotate = autoRotate), 2500)
    }
    controls.addEventListener('start', start)
    controls.addEventListener('end', end)
    return () => {
      window.clearTimeout(idle)
      controls.removeEventListener('start', start)
      controls.removeEventListener('end', end)
    }
  }, [controls, autoRotate])

  useEffect(() => () => controls.dispose(), [controls])

  // Narrow viewports need the camera further out to fit the orbit and labels.
  useEffect(() => {
    camera.position.setLength(width < 640 ? 11.5 : 10.5)
    controls.update()
  }, [camera, controls, width])

  useFrame(() => controls.update())
  return null
}
