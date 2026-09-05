import { createHash } from 'node:crypto'
import type { IncomingMessage, Server as HttpServer } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'

type EmployeeRole = 'EMPLOYEE' | 'IDENTITY_REVIEWER' | 'SUPER_ADMIN'
type WorkQueueEvent = {
  entity: 'APPLICATION' | 'SERVICE_REQUEST' | 'IDENTITY_REVIEW'
  action: 'CREATED' | 'UPDATED'
  reference?: string
}

type Options = {
  server: HttpServer
  authenticateEmployee: (request: IncomingMessage) => { subject: string; role: EmployeeRole } | null
  isAllowedOrigin: (origin?: string) => boolean
}

export function installEmployeeWorkQueueRealtime({ server, authenticateEmployee, isAllowedOrigin }: Options) {
  const socketsBySubject = new Map<string, Set<WebSocket>>()
  const serverSocket = new WebSocketServer({ noServer: true, clientTracking: false })
  const remove = (subject: string, socket: WebSocket) => {
    const peers = socketsBySubject.get(subject)
    if (!peers) return
    peers.delete(socket)
    if (peers.size === 0) socketsBySubject.delete(subject)
  }
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '/', 'http://localhost')
    if (url.pathname !== '/ws/employee-work-queue') return
    const origin = request.headers.origin
    if (!isAllowedOrigin(origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    const actor = authenticateEmployee(request)
    if (!actor) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    const subject = `${actor.role}:${actor.subject}`
    const existing = socketsBySubject.get(subject) || new Set<WebSocket>()
    if (existing.size >= 4) {
      socket.write('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    serverSocket.handleUpgrade(request, socket, head, webSocket => {
      existing.add(webSocket)
      socketsBySubject.set(subject, existing)
      webSocket.send(JSON.stringify({ type: 'employee.work-queue.connected' }))
      webSocket.on('pong', () => {
        ;(webSocket as WebSocket & { alive?: boolean }).alive = true
      })
      webSocket.on('close', () => remove(subject, webSocket))
      webSocket.on('error', () => remove(subject, webSocket))
    })
  })
  const heartbeat = setInterval(() => {
    socketsBySubject.forEach((peers, subject) =>
      peers.forEach(socket => {
        const tracked = socket as WebSocket & { alive?: boolean }
        if (tracked.alive === false) {
          socket.terminate()
          remove(subject, socket)
          return
        }
        tracked.alive = false
        socket.ping()
      })
    )
  }, 30_000)
  heartbeat.unref()
  return {
    publish(event: WorkQueueEvent) {
      const message = JSON.stringify({ type: 'employee.work-queue.updated', payload: event })
      socketsBySubject.forEach(peers =>
        peers.forEach(socket => {
          if (socket.readyState === WebSocket.OPEN) socket.send(message)
        })
      )
    },
    activeCount() {
      return [...socketsBySubject.values()].reduce((total, peers) => total + peers.size, 0)
    },
  }
}
