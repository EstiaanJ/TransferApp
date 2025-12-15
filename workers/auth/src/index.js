export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = allowedOriginFor(request, env);

    if (request.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }), origin);
    }
    if (request.method === 'POST' && url.pathname === '/signup') {
      return withCors(await handleSignup(request, env), origin);
    }
    if (request.method === 'POST' && url.pathname === '/login') {
      return withCors(await handleLogin(request, env), origin);
    }
    if (request.method === 'POST' && url.pathname === '/proxy/echo') {
      return withCors(await handleEchoProxy(request, env), origin);
    }
    if (request.method === 'GET' && url.pathname === '/healthz') {
      return withCors(new Response('ok'), origin);
    }

    return withCors(jsonResponse({ message: 'Not found' }, 404), origin);
  }
};

async function handleSignup(request, env) {
  const payload = await readJSON(request);
  if (!payload) return jsonResponse({ error: 'Invalid JSON' }, 400);

  const { email, password, signupSecret } = payload;
  if (!email || !password || !signupSecret) {
    return jsonResponse({ error: 'email, password, and signupSecret are required' }, 400);
  }
  if (signupSecret !== env.SIGNUP_GATE_SECRET) {
    return jsonResponse({ error: 'Invalid signup secret' }, 401);
  }
  if (password.length < 8) {
    return jsonResponse({ error: 'Password must be at least 8 characters' }, 400);
  }

  const salt = crypto.randomUUID().replaceAll('-', '');
  const passwordHash = await hashPassword(password, salt);
  const now = new Date().toISOString();
  try {
    await env.DB.prepare(
      `INSERT INTO users (email, password_hash, password_salt, created_at)
       VALUES (?1, ?2, ?3, ?4);`
    ).bind(email.toLowerCase(), passwordHash, salt, now).run();
  } catch (err) {
    if (String(err).includes('UNIQUE')) {
      return jsonResponse({ error: 'Email already registered' }, 409);
    }
    console.error('signup error', err);
    return jsonResponse({ error: 'Unexpected error' }, 500);
  }

  return jsonResponse({ message: 'Account created' }, 201);
}

async function handleLogin(request, env) {
  const payload = await readJSON(request);
  if (!payload) return jsonResponse({ error: 'Invalid JSON' }, 400);
  const { email, password } = payload;
  if (!email || !password) return jsonResponse({ error: 'email and password are required' }, 400);

  const row = await env.DB.prepare(
    `SELECT id, password_hash, password_salt FROM users WHERE email = ?1 LIMIT 1;`
  ).bind(email.toLowerCase()).first();

  if (!row) return jsonResponse({ error: 'Invalid credentials' }, 401);
  const computed = await hashPassword(password, row.password_salt);
  if (computed !== row.password_hash) return jsonResponse({ error: 'Invalid credentials' }, 401);

  const issuedAt = Math.floor(Date.now() / 1000);
  const exp = issuedAt + 3600; // 1 hour
  const tokenPayload = { sub: row.id, email: email.toLowerCase(), iat: issuedAt, exp };
  const token = await signCompactToken(tokenPayload, env.JWT_SIGNING_KEY);
  return jsonResponse({ token, expiresInSeconds: 3600 });
}

async function handleEchoProxy(request, env) {
  if (!env.BACKEND_URL) {
    return jsonResponse({ error: 'BACKEND_URL not configured' }, 500);
  }
  const auth = request.headers.get('Authorization');
  const payload = await readJSON(request);
  const body = JSON.stringify({ message: payload?.message ?? 'ping' });
  const target = `${env.BACKEND_URL.replace(/\/$/, '')}/echo`;

  const res = await fetch(target, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(auth ? { Authorization: auth } : {})
    },
    body
  });

  const text = await res.text();
  return new Response(text, { status: res.status, headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'text/plain' } });
}

async function hashPassword(password, salt) {
  const encoder = new TextEncoder();
  const data = encoder.encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bufferToBase64(digest);
}

async function signCompactToken(payload, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const body = btoa(JSON.stringify(payload));
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  const signature = bufferToBase64(signatureBuffer);
  return `${body}.${signature}`;
}

async function readJSON(request) {
  try {
    return await request.json();
  } catch (_) {
    return null;
  }
}

function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
}

function allowedOriginFor(request, env) {
  if (env.FRONTEND_ORIGIN) return env.FRONTEND_ORIGIN;
  return request.headers.get('Origin') || '*';
}

function withCors(response, origin) {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  headers.set('Access-Control-Max-Age', '86400');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
