import { appendFile } from 'node:fs/promises';

/** Sends magic-link emails. The rest of the app only knows this interface. */
export interface Mailer {
  sendMagicLink: (email: string, link: string) => Promise<void>;
}

/** Development: print the link in the API terminal instead of emailing it. */
export class ConsoleMailer implements Mailer {
  sendMagicLink(email: string, link: string): Promise<void> {
    // eslint-disable-next-line no-console -- the dev magic-link logger, allowed by the brief (§14).
    console.log(`\nMagic link for ${email}:\n  ${link}\n`);
    return Promise.resolve();
  }
}

/** Automated tests (E2E): append each link as a JSON line so a test can read it. */
export class FileMailer implements Mailer {
  constructor(private readonly path: string) {}
  async sendMagicLink(email: string, link: string): Promise<void> {
    await appendFile(this.path, `${JSON.stringify({ email, link })}\n`);
  }
}

/** Unit tests: keep links in memory. */
export class MemoryMailer implements Mailer {
  readonly sent: { email: string; link: string }[] = [];
  sendMagicLink(email: string, link: string): Promise<void> {
    this.sent.push({ email, link });
    return Promise.resolve();
  }
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Production: Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email). */
export class ResendMailer implements Mailer {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}
  async sendMagicLink(email: string, link: string): Promise<void> {
    const href = escapeHtml(link);
    const res = await this.fetchFn('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: this.from,
        to: [email],
        subject: 'Your sign-in link',
        text: `Open this link to sign in to Recall. It works once and expires in 15 minutes.

${link}

If you didn't ask for it, ignore this email.
`,
        html: `<p>Open this link to sign in to Recall. It works once and expires in 15 minutes.</p><p><a href="${href}">Sign in to Recall</a></p><p>If you didn't ask for it, ignore this email.</p>`,
      }),
    });
    if (!res.ok) {
      let reason = '';
      try {
        const data = (await res.json()) as { message?: unknown };
        if (typeof data.message === 'string') reason = `: ${data.message}`;
      } catch {
        // no JSON body
      }
      throw new Error(`Resend returned ${String(res.status)}${reason}`);
    }
  }
}
