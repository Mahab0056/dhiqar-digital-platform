import { port } from './config.js'
import { createPlatformServer } from './create-server.js'

// Process guards: a failing background job (OCR worker, face match, push delivery) must never take the API down.
process.on('unhandledRejection', reason => {
  console.error('[process] unhandled rejection', reason)
})
process.on('uncaughtException', error => {
  console.error('[process] uncaught exception', error)
})

const { httpServer } = createPlatformServer()

httpServer.listen(port, '0.0.0.0', () => {
  console.log(`Dhi Qar Digital API listening on http://0.0.0.0:${port}`)
})
