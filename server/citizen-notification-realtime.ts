import type { IncomingMessage, Server as HttpServer } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'

type NotificationSnapshot = {
  unread: number
  items: Array<{ id: string; type: string; title: string; message: string; link: string | null; readAt: string | null; createdAt: string }>
}

type RealtimeOptions = {
  server: HttpServer
  authenticateCitizen: (request: IncomingMessage) => number | null
  isAllowedOrigin: (origin?: string) => boolean
}

type RealtimeClient = { socket: WebSocket; lastPongAt: number }
const pathName = '/ws/citizen-notifications'
const maxConnectionsPerCitizen = 4

function denyUpgrade(socket: import('node:net').Socket, status: number, message: string) {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`)
  socket.destroy()
}

export function installCitizenNotificationRealtime(options: RealtimeOptions) {
  const clientsByCitizen = new Map<number, Set<RealtimeClient>>()
  const webSocketServer = new WebSocketServer({ noServer: true, clientTracking: false })

  const remove = (citizenId: number, client: RealtimeClient) => {
    const clients = clientsByCitizen.get(citizenId)
    if (!clients) return
    clients.delete(client)
    if (clients.size === 0) clientsByCitizen.delete(citizenId)
  }

  options.server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '/', 'http://localhost')
    if (url.pathname !== pathName) return
    if (!options.isAllowedOrigin(request.headers.origin)) return denyUpgrade(socket, 403, 'Forbidden')
    const citizenId = options.authenticateCitizen(request)
    if (!citizenId) return denyUpgrade(socket, 401, 'Unauthorized')
    const existing = clientsByCitizen.get(citizenId)
    if (existing && existing.size >= maxConnectionsPerCitizen) return denyUpgrade(socket, 429, 'Too Many Connections')
    webSocketServer.handleUpgrade(request, socket, head, webSocket => {
      const client: RealtimeClient = { socket: webSocket, lastPongAt: Date.now() }
      const clients = clientsByCitizen.get(citizenId) || new Set<RealtimeClient>()
      clients.add(client)
      clientsByCitizen.set(citizenId, clients)
      webSocket.on('pong', () => { client.lastPongAt = Date.now() })
      webSocket.once('close', () => remove(citizenId, client))
      webSocket.once('error', () => remove(citizenId, client))
      webSocket.send(JSON.stringify({ type: 'citizen.notifications.connected' }))
    })
  })

  const heartbeat = setInterval(() => {
    const staleAfterMs = 70_000
    for (const clients of clientsByCitizen.values()) for (const client of clients) {
      if (client.socket.readyState !== WebSocket.OPEN || Date.now() - client.lastPongAt > staleAfterMs) {
        client.socket.terminate()
      } else client.socket.ping()
    }
  }, 25_000)
  heartbeat.unref()

  return {
    publish(citizenId: number, payload: NotificationSnapshot) {
      const serialized = JSON.stringify({ type: 'citizen.notifications.updated', payload })
      for (const client of clientsByCitizen.get(citizenId) || []) {
        if (client.socket.readyState === WebSocket.OPEN) client.socket.send(serialized)
      }
    },
    activeConnections(citizenId?: number) {
      if (citizenId) return clientsByCitizen.get(citizenId)?.size || 0
      return Array.from(clientsByCitizen.values()).reduce((total, clients) => total + clients.size, 0)
    },
  }
}
