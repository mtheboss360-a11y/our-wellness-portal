// Email to the team, through Resend's HTTP API (no SDK, no SMTP). Two settings on the server:
//   RESEND_API_KEY     the Resend key (never logged, never sent to a browser)
//   REQUEST_EMAIL_TO   where requests go, e.g. the owner's inbox
// Optional REQUEST_EMAIL_FROM; without a verified domain Resend only sends from onboarding@resend.dev.
// Never throws: a failed send is reported as false and the request is still saved.

export const emailConfigured = () => Boolean(process.env.RESEND_API_KEY?.trim() && process.env.REQUEST_EMAIL_TO?.trim());

export async function sendTeamEmail(subject: string, text: string, replyTo?: string) {
  if (!emailConfigured()) return false;
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY!.trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.REQUEST_EMAIL_FROM?.trim() || 'Our Wellness Network <onboarding@resend.dev>', to: process.env.REQUEST_EMAIL_TO!.split(',').map(a => a.trim()).filter(Boolean), subject, text, ...(replyTo ? { reply_to: replyTo } : {}) }),
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  } catch { return false; }
}
