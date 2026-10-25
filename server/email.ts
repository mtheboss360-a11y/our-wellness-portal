// Email to the team. Requests go to the owner's inbox through FormSubmit (formsubmit.co): no account and no
// key; the very first message sends a one-time activation email to that inbox, and after it is clicked every
// request arrives as a normal email.
//   REQUEST_EMAIL_TO   overrides the inbox (comma-separated for more than one)
//   RESEND_API_KEY     optional: send through Resend instead (REQUEST_EMAIL_FROM sets the sender)
// Never throws: a failed send is reported as false and the request is still saved.

const DEFAULT_INBOX = 'mtheboss360@gmail.com';
const inbox = () => (process.env.REQUEST_EMAIL_TO?.trim() || DEFAULT_INBOX).split(',').map(a => a.trim()).filter(Boolean);

export async function sendTeamEmail(subject: string, text: string, fields: Record<string, string> = {}) {
  if (process.env.REQUEST_EMAIL_OFF === 'true') return false;   // tests
  try {
    if (process.env.RESEND_API_KEY?.trim()) {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST', signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY.trim()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: process.env.REQUEST_EMAIL_FROM?.trim() || 'Our Wellness Network <onboarding@resend.dev>', to: inbox(), subject, text }),
      });
      return response.ok;
    }
    const [to, ...cc] = inbox();
    const response = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(to)}`, {
      method: 'POST', signal: AbortSignal.timeout(10_000),
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Referer: 'https://www.ournetworkportal.com/', Origin: 'https://www.ournetworkportal.com' },
      body: JSON.stringify({ _subject: subject, _template: 'table', _captcha: 'false', ...(cc.length ? { _cc: cc.join(',') } : {}), ...fields, Message: text }),
    });
    const result = await response.json().catch(() => null) as { success?: string | boolean } | null;
    return response.ok && String(result?.success) === 'true';
  } catch { return false; }
}
