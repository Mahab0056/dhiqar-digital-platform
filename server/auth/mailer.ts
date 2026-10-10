// Transactional email for staff sign-in codes. Provider: Resend (HTTP API, RESEND_API_KEY + MAIL_FROM).
// Without a provider, development prints the message to the console; production never does (the method is hidden).

export type MailMessage = { to: string; subject: string; html: string; text: string }
type Transport = (message: MailMessage) => Promise<void>

let override: Transport | null = null
/** Tests capture outgoing mail instead of calling a provider. */
export function setMailTransport(next: Transport | null) {
  override = next
}

const isProductionRuntime = () => process.env.NODE_ENV === 'production'

export function mailProvider(): 'test' | 'resend' | 'dev-console' | null {
  if (override) return 'test'
  if (process.env.RESEND_API_KEY?.trim() && process.env.MAIL_FROM?.trim()) return 'resend'
  if (!isProductionRuntime()) return 'dev-console'
  return null
}

export const mailConfigured = () => mailProvider() !== null

async function sendWithResend(message: MailMessage) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY!.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.MAIL_FROM!.trim(),
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
    }),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Resend responded ${response.status}: ${detail.slice(0, 200)}`)
  }
}

export async function sendMail(message: MailMessage, devConsoleLine?: string) {
  const provider = mailProvider()
  if (provider === 'test') return override!(message)
  if (provider === 'resend') return sendWithResend(message)
  if (provider === 'dev-console') {
    console.log(devConsoleLine || `[mail] DEV MODE — "${message.subject}" to ${message.to}`)
    return
  }
  throw new Error('No mail provider configured.')
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)

/** Arabic RTL sign-in code email, branded "ذي قار الرقمية". */
export function staffLoginCodeEmail(input: { to: string; fullName: string; code: string; expiresInMinutes: number }) {
  // the code stays out of the subject so it doesn't show on lock-screen notifications
  const subject = 'رمز الدخول إلى بوابة موظفي ذي قار الرقمية'
  const name = escapeHtml(input.fullName)
  const text = [
    `مرحباً ${input.fullName}،`,
    '',
    `رمز الدخول إلى بوابة موظفي ذي قار الرقمية هو: ${input.code}`,
    `ينتهي الرمز خلال ${input.expiresInMinutes} دقائق ويُستخدم مرة واحدة فقط.`,
    '',
    'إذا لم تطلب هذا الرمز فتجاهل الرسالة؛ لن يتمكن أحد من الدخول دون الرمز. لا تشارك الرمز مع أي شخص، فموظفو المنصة لن يطلبوه منك أبداً.',
    '',
    'ذي قار الرقمية — محافظة ذي قار',
  ].join('\n')
  const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f1ea;font-family:Tahoma,Arial,sans-serif;color:#1f2a2e;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f1ea;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border:1px solid #e3ddd0;border-radius:14px;overflow:hidden;">
        <tr><td style="background:#0f4c45;color:#ffffff;padding:18px 24px;font-size:18px;font-weight:bold;text-align:right;">ذي قار الرقمية</td></tr>
        <tr><td style="padding:24px;text-align:right;line-height:1.9;font-size:15px;">
          <p style="margin:0 0 12px;">مرحباً ${name}،</p>
          <p style="margin:0 0 16px;">استخدم الرمز التالي لتسجيل الدخول إلى بوابة موظفي ذي قار الرقمية:</p>
          <p dir="ltr" style="margin:0 0 16px;text-align:center;font-family:'Courier New',monospace;font-size:32px;letter-spacing:8px;font-weight:bold;color:#0f4c45;background:#eef5f3;border-radius:10px;padding:14px 0;">${escapeHtml(input.code)}</p>
          <p style="margin:0 0 8px;">ينتهي الرمز خلال ${input.expiresInMinutes} دقائق ويُستخدم مرة واحدة فقط.</p>
          <p style="margin:0;color:#6b6b6b;font-size:13px;">إذا لم تطلب هذا الرمز فتجاهل الرسالة. لا تشارك الرمز مع أي شخص؛ فريق المنصة لن يطلبه منك أبداً.</p>
        </td></tr>
        <tr><td style="padding:14px 24px;border-top:1px solid #eee7da;color:#8a8a8a;font-size:12px;text-align:right;">محافظة ذي قار — المنصة الحكومية الرقمية · thi-qar.com</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
  return { to: input.to, subject, html, text }
}
