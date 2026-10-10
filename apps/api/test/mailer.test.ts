import { describe, expect, it } from 'vitest';
import { ResendMailer } from '../src/mailer';

// The production mailer (MAIL_MODE=resend). No network: fetch is injected.

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(response: Response) {
  const calls: Call[] = [];
  const fetchFn: typeof fetch = (url, init) => {
    calls.push({ url: url instanceof Request ? url.url : url.toString(), init: init ?? {} });
    return Promise.resolve(response);
  };
  return { calls, fetchFn };
}

const LINK = 'https://api.example.org/auth/verify?token=abc123';

describe('ResendMailer', () => {
  it('posts one email to Resend with the key, sender, recipient and link', async () => {
    const { calls, fetchFn } = fakeFetch(new Response('{"id":"1"}', { status: 200 }));
    const mailer = new ResendMailer('re_test_key', 'Recall <login@example.org>', fetchFn);
    await mailer.sendMagicLink('student@example.org', LINK);

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe('https://api.resend.com/emails');
    expect(call?.init.method).toBe('POST');
    expect(call?.init.headers).toMatchObject({
      Authorization: 'Bearer re_test_key',
      'Content-Type': 'application/json',
    });
    const body = JSON.parse(call?.init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      from: 'Recall <login@example.org>',
      to: ['student@example.org'],
      subject: 'Your sign-in link',
    });
    expect(body.text).toContain(LINK);
    expect(body.html).toContain(`href="${LINK}"`);
  });

  it('escapes the link in the HTML body', async () => {
    const { calls, fetchFn } = fakeFetch(new Response('{}', { status: 200 }));
    const mailer = new ResendMailer('k', 'Recall <a@example.org>', fetchFn);
    await mailer.sendMagicLink('s@example.org', 'https://x.example/v?a=1&b="2"');
    const body = JSON.parse(calls[0]?.init.body as string) as { html: string };
    expect(body.html).toContain('href="https://x.example/v?a=1&amp;b=&quot;2&quot;"');
  });

  it("fails with Resend's status and message, so the reason shows up in the log", async () => {
    const { fetchFn } = fakeFetch(
      new Response('{"name":"validation_error","message":"The domain is not verified."}', {
        status: 403,
      }),
    );
    const mailer = new ResendMailer('k', 'Recall <a@example.org>', fetchFn);
    await expect(mailer.sendMagicLink('s@example.org', LINK)).rejects.toThrow(
      'Resend returned 403: The domain is not verified.',
    );
  });
});
