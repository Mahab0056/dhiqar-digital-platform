import type express from 'express'

/** Returns a route parameter as a single string (Express 5 types allow string[] for wildcard params). */
export function param(req: express.Request, name: string) {
  const value = (req.params as Record<string, string | string[] | undefined>)[name]
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '')
}

/** Arabic-Indic (٠-٩) and Persian (۰-۹) digits → ASCII. Iraqi phone keyboards often type these in phone/OTP/number fields. */
export function toLatinDigits(value: string) {
  return value.replace(/[\u0660-\u0669\u06f0-\u06f9]/g, digit => String(digit.charCodeAt(0) & 0xf))
}
