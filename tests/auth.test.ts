import { describe, it, expect } from 'vitest';
import { IncomingMessage, ServerResponse } from 'http';
import { checkAuth } from '../src/index';

/**
 * Create a minimal mock request with optional headers.
 */
function mockReq(headers: Record<string, string> = {}): IncomingMessage {
  return { headers } as any;
}

/**
 * Create a minimal mock response that captures status and output.
 */
function mockRes(): ServerResponse & { _status: number; _headers: Record<string, string>; _body: string } {
  const res: any = {
    _status: 200,
    _headers: {},
    _body: '',
    set statusCode(code: number) { res._status = code; },
    get statusCode() { return res._status; },
    setHeader(key: string, value: string) { res._headers[key.toLowerCase()] = value; },
    end(body?: string) { res._body = body || ''; },
  };
  return res;
}

function basicAuth(user: string, pass: string): string {
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

describe('checkAuth', () => {
  it('allows requests when no auth configured', () => {
    const req = mockReq();
    const res = mockRes();
    expect(checkAuth(req, res, undefined)).toBe(true);
  });

  it('allows requests when mode is none', () => {
    const req = mockReq();
    const res = mockRes();
    expect(checkAuth(req, res, { mode: 'none' })).toBe(true);
  });

  // --- Token mode ---

  it('rejects requests without token in token mode', () => {
    const req = mockReq();
    const res = mockRes();
    expect(checkAuth(req, res, { mode: 'token', token: 'secret123' })).toBe(false);
    expect(res._status).toBe(401);
    expect(res._headers['www-authenticate']).toBe('Basic realm="ClawCal"');
  });

  it('accepts Bearer token', () => {
    const req = mockReq({ authorization: 'Bearer secret123' });
    const res = mockRes();
    expect(checkAuth(req, res, { mode: 'token', token: 'secret123' })).toBe(true);
  });

  it('rejects wrong Bearer token', () => {
    const req = mockReq({ authorization: 'Bearer wrong' });
    const res = mockRes();
    expect(checkAuth(req, res, { mode: 'token', token: 'secret123' })).toBe(false);
    expect(res._status).toBe(401);
  });

  it('accepts Basic auth with token as password', () => {
    const req = mockReq({ authorization: basicAuth('any-user', 'secret123') });
    const res = mockRes();
    expect(checkAuth(req, res, { mode: 'token', token: 'secret123' })).toBe(true);
  });

  it('allows all when token mode but no token set', () => {
    const req = mockReq();
    const res = mockRes();
    expect(checkAuth(req, res, { mode: 'token', token: '' })).toBe(true);
  });

  // --- Password mode ---

  it('rejects requests without password in password mode', () => {
    const req = mockReq();
    const res = mockRes();
    expect(checkAuth(req, res, { mode: 'password', password: 'mypass' })).toBe(false);
    expect(res._status).toBe(401);
  });

  it('accepts correct password via Basic auth', () => {
    const req = mockReq({ authorization: basicAuth('user', 'mypass') });
    const res = mockRes();
    expect(checkAuth(req, res, { mode: 'password', password: 'mypass' })).toBe(true);
  });

  it('rejects wrong password', () => {
    const req = mockReq({ authorization: basicAuth('user', 'wrong') });
    const res = mockRes();
    expect(checkAuth(req, res, { mode: 'password', password: 'mypass' })).toBe(false);
    expect(res._status).toBe(401);
  });

  // --- Trusted proxy mode ---

  it('accepts trusted proxy with valid user header', () => {
    const req = mockReq({ 'x-forwarded-user': 'nick@example.com' });
    const res = mockRes();
    expect(checkAuth(req, res, {
      mode: 'trusted-proxy',
      trustedProxy: { userHeader: 'x-forwarded-user' },
    })).toBe(true);
  });

  it('rejects trusted proxy without user header', () => {
    const req = mockReq();
    const res = mockRes();
    expect(checkAuth(req, res, {
      mode: 'trusted-proxy',
      trustedProxy: { userHeader: 'x-forwarded-user' },
    })).toBe(false);
    expect(res._status).toBe(403);
  });

  it('rejects trusted proxy with missing required headers', () => {
    const req = mockReq({ 'x-forwarded-user': 'nick@example.com' });
    const res = mockRes();
    expect(checkAuth(req, res, {
      mode: 'trusted-proxy',
      trustedProxy: {
        userHeader: 'x-forwarded-user',
        requiredHeaders: ['x-forwarded-proto'],
      },
    })).toBe(false);
    expect(res._status).toBe(403);
  });

  it('accepts trusted proxy with all required headers', () => {
    const req = mockReq({
      'x-forwarded-user': 'nick@example.com',
      'x-forwarded-proto': 'https',
    });
    const res = mockRes();
    expect(checkAuth(req, res, {
      mode: 'trusted-proxy',
      trustedProxy: {
        userHeader: 'x-forwarded-user',
        requiredHeaders: ['x-forwarded-proto'],
      },
    })).toBe(true);
  });

  it('rejects user not in allowlist', () => {
    const req = mockReq({ 'x-forwarded-user': 'hacker@evil.com' });
    const res = mockRes();
    expect(checkAuth(req, res, {
      mode: 'trusted-proxy',
      trustedProxy: {
        userHeader: 'x-forwarded-user',
        allowUsers: ['nick@example.com'],
      },
    })).toBe(false);
    expect(res._status).toBe(403);
  });

  it('accepts user in allowlist', () => {
    const req = mockReq({ 'x-forwarded-user': 'nick@example.com' });
    const res = mockRes();
    expect(checkAuth(req, res, {
      mode: 'trusted-proxy',
      trustedProxy: {
        userHeader: 'x-forwarded-user',
        allowUsers: ['nick@example.com', 'admin@example.com'],
      },
    })).toBe(true);
  });

  // --- Fail-closed on unknown mode ---

  it('rejects requests with unknown auth mode (fail-closed)', () => {
    const req = mockReq();
    const res = mockRes();
    expect(checkAuth(req, res, { mode: 'oauth' as any })).toBe(false);
    expect(res._status).toBe(500);
  });

  it('rejects requests with typo in auth mode', () => {
    const req = mockReq({ authorization: 'Bearer secret123' });
    const res = mockRes();
    expect(checkAuth(req, res, { mode: 'Token' as any, token: 'secret123' })).toBe(false);
    expect(res._status).toBe(500);
  });
});
