import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  API_ORIGIN,
  closeTestPrisma,
  DAY,
  lastTokenFor,
  makeTestApp,
  MINUTE,
  HOUR,
  resetDb,
  signIn,
  WEB_ORIGIN,
} from './helpers';

interface ErrorBody {
  error: { code: string; message: string };
}

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await closeTestPrisma();
});

describe('POST /auth/magic-link', () => {
  it('emails a one-time link and stores only a hash of the token', async () => {
    const t = makeTestApp();
    const res = await request(t.app).post('/auth/magic-link').send({ email: 'a@example.com' });
    expect(res.status).toBe(202);
    expect(t.mailer.sent).toHaveLength(1);
    const link = t.mailer.sent[0]?.link ?? '';
    expect(link.startsWith(`${API_ORIGIN}/auth/verify?token=`)).toBe(true);
    const token = lastTokenFor(t.mailer, 'a@example.com');
    const rows = await t.prisma.magicLinkToken.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).not.toContain(token);
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(rows[0]?.expiresAt.getTime()).toBe(t.now() + 15 * MINUTE);
  });

  it('normalises the email (trim, lower case)', async () => {
    const t = makeTestApp();
    await request(t.app).post('/auth/magic-link').send({ email: '  Ana@Example.COM ' }).expect(202);
    expect(t.mailer.sent[0]?.email).toBe('ana@example.com');
  });

  it('rejects an invalid email with the standard error format', async () => {
    const t = makeTestApp();
    const res = await request(t.app).post('/auth/magic-link').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { code: 'invalid_request', message: expect.any(String) as string },
    });
  });

  it('rate limits to 5 requests per email per hour', async () => {
    const t = makeTestApp();
    for (let i = 0; i < 5; i++) {
      await request(t.app).post('/auth/magic-link').send({ email: 'a@example.com' }).expect(202);
    }
    const res = await request(t.app).post('/auth/magic-link').send({ email: 'a@example.com' });
    expect(res.status).toBe(429);
    expect((res.body as ErrorBody).error.code).toBe('rate_limited');
    t.advance(HOUR);
    await request(t.app).post('/auth/magic-link').send({ email: 'a@example.com' }).expect(202);
  });

  it('rate limits to 20 requests per IP per hour', async () => {
    const t = makeTestApp();
    for (let i = 0; i < 20; i++) {
      await request(t.app)
        .post('/auth/magic-link')
        .send({ email: `u${String(i)}@example.com` })
        .expect(202);
    }
    const res = await request(t.app).post('/auth/magic-link').send({ email: 'x@example.com' });
    expect(res.status).toBe(429);
  });
});

describe('GET /auth/verify', () => {
  it('consumes the token, creates a session cookie and redirects to the app', async () => {
    const t = makeTestApp();
    await request(t.app).post('/auth/magic-link').send({ email: 'a@example.com' });
    const res = await request(t.app)
      .get('/auth/verify')
      .query({ token: lastTokenFor(t.mailer, 'a@example.com') });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(`${WEB_ORIGIN}/settings?signedIn=1`);
    const cookie = (res.headers['set-cookie'] as unknown as string[])[0] ?? '';
    expect(cookie).toMatch(/^recall_session=[A-Za-z0-9_-]{43};/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain(`Max-Age=${String(60 * 24 * 60 * 60)}`);

    const sessions = await t.prisma.session.findMany();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.expiresAt.getTime()).toBe(t.now() + 60 * DAY);
    const sessionToken = cookie.split(';')[0]?.split('=')[1] ?? '';
    expect(sessions[0]?.tokenHash).not.toBe(sessionToken);
  });

  it('a token works only once', async () => {
    const t = makeTestApp();
    await request(t.app).post('/auth/magic-link').send({ email: 'a@example.com' });
    const token = lastTokenFor(t.mailer, 'a@example.com');
    await request(t.app).get('/auth/verify').query({ token }).expect(303);
    const again = await request(t.app).get('/auth/verify').query({ token });
    expect(again.status).toBe(303);
    expect(again.headers.location).toBe(`${WEB_ORIGIN}/settings?signInError=invalid`);
    expect(again.headers['set-cookie']).toBeUndefined();
  });

  it('a token expires after 15 minutes', async () => {
    const t = makeTestApp();
    await request(t.app).post('/auth/magic-link').send({ email: 'a@example.com' });
    t.advance(15 * MINUTE + 1);
    const res = await request(t.app)
      .get('/auth/verify')
      .query({ token: lastTokenFor(t.mailer, 'a@example.com') });
    expect(res.headers.location).toBe(`${WEB_ORIGIN}/settings?signInError=invalid`);
  });

  it('an unknown token is rejected', async () => {
    const t = makeTestApp();
    const res = await request(t.app).get('/auth/verify').query({ token: 'nope' });
    expect(res.headers.location).toBe(`${WEB_ORIGIN}/settings?signInError=invalid`);
  });

  it('signing in twice with the same email gives the same user', async () => {
    const t = makeTestApp();
    const c1 = await signIn(t, 'a@example.com');
    const c2 = await signIn(t, 'A@example.com');
    const me1 = await request(t.app).get('/me').set('Cookie', c1).expect(200);
    const me2 = await request(t.app).get('/me').set('Cookie', c2).expect(200);
    expect((me1.body as { id: string }).id).toBe((me2.body as { id: string }).id);
    expect(await t.prisma.user.count()).toBe(1);
  });

  it('can issue a non-Secure cookie when configured (plain-http development)', async () => {
    const t = makeTestApp({ cookieSecure: false });
    await request(t.app).post('/auth/magic-link').send({ email: 'a@example.com' });
    const res = await request(t.app)
      .get('/auth/verify')
      .query({ token: lastTokenFor(t.mailer, 'a@example.com') });
    expect((res.headers['set-cookie'] as unknown as string[])[0]).not.toContain('Secure');
  });
});

describe('GET /me and POST /auth/logout', () => {
  it('/me returns the signed-in user', async () => {
    const t = makeTestApp();
    const cookie = await signIn(t, 'a@example.com');
    const res = await request(t.app).get('/me').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: expect.any(String) as string, email: 'a@example.com' });
  });

  it('/me is 401 without a session, with the standard error format', async () => {
    const t = makeTestApp();
    const res = await request(t.app).get('/me');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: { code: 'unauthorized', message: expect.any(String) as string },
    });
    await request(t.app).get('/me').set('Cookie', 'recall_session=bogus').expect(401);
  });

  it('sessions expire after 60 days', async () => {
    const t = makeTestApp();
    const cookie = await signIn(t, 'a@example.com');
    t.advance(60 * DAY - 1);
    await request(t.app).get('/me').set('Cookie', cookie).expect(200);
    t.advance(1);
    await request(t.app).get('/me').set('Cookie', cookie).expect(401);
  });

  it('logout deletes the session and clears the cookie', async () => {
    const t = makeTestApp();
    const cookie = await signIn(t, 'a@example.com');
    const res = await request(t.app).post('/auth/logout').set('Cookie', cookie);
    expect(res.status).toBe(204);
    expect((res.headers['set-cookie'] as unknown as string[])[0]).toMatch(/^recall_session=;/);
    expect(await t.prisma.session.count()).toBe(0);
    await request(t.app).get('/me').set('Cookie', cookie).expect(401);
  });
});

describe('CORS and errors', () => {
  it('allows only the web app origin, with credentials', async () => {
    const t = makeTestApp();
    const ok = await request(t.app)
      .options('/sync/pull')
      .set('Origin', WEB_ORIGIN)
      .set('Access-Control-Request-Method', 'GET');
    expect(ok.headers['access-control-allow-origin']).toBe(WEB_ORIGIN);
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    const bad = await request(t.app)
      .options('/sync/pull')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'GET');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('unknown routes are 404 in the standard error format', async () => {
    const t = makeTestApp();
    const res = await request(t.app).get('/nope');
    expect(res.status).toBe(404);
    expect((res.body as ErrorBody).error.code).toBe('not_found');
  });

  it('malformed JSON is a 400 in the standard error format', async () => {
    const t = makeTestApp();
    const res = await request(t.app)
      .post('/auth/magic-link')
      .set('Content-Type', 'application/json')
      .send('{"email":');
    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).error.code).toBe('invalid_request');
  });
});
