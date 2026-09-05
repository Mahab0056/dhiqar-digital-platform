import type express from 'express'

/** Returns a route parameter as a single string (Express 5 types allow string[] for wildcard params). */
export function param(req: express.Request, name: string) {
  const value = (req.params as Record<string, string | string[] | undefined>)[name]
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '')
}
