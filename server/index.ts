import { port } from './config.js'
import { createPlatformServer } from './create-server.js'

const { httpServer } = createPlatformServer()

httpServer.listen(port, '0.0.0.0', () => {
  console.log(`Dhi Qar Digital API listening on http://0.0.0.0:${port}`)
})
