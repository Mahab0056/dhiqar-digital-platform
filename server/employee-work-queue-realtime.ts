import type { IncomingMessage, Server as HttpServer } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'

type EmployeeRole = 'EMPLOYEE' | 'IDENTITY_REVIEWER' | 'SUPER_ADMIN'
export type WorkQueueEvent = {
  entity: 'APPLICATION' | 'SERVICE_REQUEST' | 'IDENTITY_REVIEW' | 'FEEDBACK'
  action: 'CREATED' | 'UPDATED'
  reference?: string
  /** When set, only staff of this department (plus super admins) receive the event. */
  departmentId?: string | null
}

type Options = {
  server: HttpServer
  authenticateEmployee: (
    request: IncomingMessage
  ) => { subject: string; role: EmployeeRole; departmentId?: string | null } | null
  isAllowedOrigin: (origin?: string) => boolean
}

export function installEmployeeWorkQueueRealtime({ server, authenticateEmployee, isAllowedOrigin }: Options) {
  const socketsBySubject = new Map<string, Set<WebSocket>>()
  const audience = new Map<string, { role: EmployeeRole; departmentId: string | null }>()
  const serverSocket = new WebSocketServer({ noServer: true, clientTracking: false })
  const remove = (subject: string, socket: WebSocket) => {
    const peers = socketsBySubject.get(subject)
    if (!peers) return
    peers.delete(socket)
    if (peers.size === 0) {
      socketsBySubject.delete(subject)
      audience.delete(subject)
    }
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
    audience.set(subject, { role: actor.role, departmentId: actor.departmentId || null })
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
      socketsBySubject.forEach((peers, subject) => {
        const who = audience.get(subject)
        if (!who) return
        // identity events go to reviewers/super admins only; department events only to that department
        if (event.entity === 'IDENTITY_REVIEW' && who.role === 'EMPLOYEE') return
        if (event.entity !== 'IDENTITY_REVIEW' && who.role === 'IDENTITY_REVIEWER') return
        if (event.departmentId && who.role === 'EMPLOYEE' && who.departmentId !== event.departmentId) return
        peers.forEach(socket => {
          if (socket.readyState === WebSocket.OPEN) socket.send(message)
        })
      })
    },
    activeCount() {
      return [...socketsBySubject.values()].reduce((total, peers) => total + peers.size, 0)
    },
  }
}
