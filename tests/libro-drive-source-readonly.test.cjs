const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { webcrypto, createHash, randomBytes } = require('node:crypto');

let tokenModule, sourceModule, common, checksums, credential, publicKey;
const originalFetch = globalThis.fetch;
const epoch = Date.parse('2026-10-09T12:00:00Z');
const fileId = 'libro-offline-fixture';
const secret = 'TOKEN_FICTICIO_NO_PUBLICAR';
const bytesFixture = Buffer.from([0x50, 0x4b, 3, 4, 0, 255, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
const hash = (algorithm, bytes) => createHash(algorithm).update(bytes).digest('hex');
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test.before(async () => {
  // A forgotten dependency injection cannot turn these tests into real HTTP calls.
  globalThis.fetch = async () => { throw new Error('RED_REAL_PROHIBIDA'); };
  [tokenModule, sourceModule, common, checksums] = await Promise.all([
    import('../supabase/functions/_shared/googleServiceAccountToken.ts'),
    import('../supabase/functions/_shared/libroDriveSource.ts'),
    import('../supabase/functions/_shared/googleDriveReadonlyCommon.ts'),
    import('../supabase/functions/_shared/libroDriveChecksums.ts'),
  ]);
  const pair = await webcrypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  publicKey = pair.publicKey;
  const pkcs8 = Buffer.from(await webcrypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
  credential = { type: 'service_account', client_email: 'lector-ficticio@fixture.iam.gserviceaccount.com',
    private_key_id: 'clave-efimera-ficticia', private_key: `-----BEGIN PRIVATE KEY-----\n${pkcs8}\n-----END PRIVATE KEY-----\n` };
});
test.after(() => { globalThis.fetch = originalFetch; });

function clock() {
  let current = epoch;
  const sleeps = [];
  return { now: () => current, advance: ms => { current += ms; }, sleeps,
    sleep: async ms => { sleeps.push(ms); current += ms; }, random: () => 0 };
}
function manualTimers(time) {
  let id = 0;
  const active = new Map(), scheduled = [];
  return { scheduled, active,
    setTimer(callback, ms) { const handle = ++id; active.set(handle, { callback, ms }); scheduled.push(ms); return handle; },
    clearTimer(handle) { active.delete(handle); },
    fireLast() { const [, timer] = [...active].at(-1); time.advance(timer.ms); timer.callback(); },
  };
}
function metadata(bytes = bytesFixture, patch = {}) {
  return { id: fileId, name: 'Libro ficticio.xlsx', mimeType: sourceModule.LIBRO_XLSX_MIME,
    modifiedTime: '2026-10-09T11:00:00.000Z', size: String(bytes.length), version: '9223372036854775807',
    md5Checksum: hash('md5', bytes), sha256Checksum: hash('sha256', bytes), trashed: false,
    capabilities: { canDownload: true }, ...patch };
}
function assertRequest(url, init, oauth = false) {
  const u = new URL(url);
  assert.equal(init.redirect, 'manual'); assert.equal(init.cache, 'no-store');
  assert.ok(init.signal instanceof AbortSignal);
  if (oauth) {
    assert.equal(url, common.GOOGLE_TOKEN_ENDPOINT); assert.equal(init.method, 'POST');
    assert.equal(init.headers['Content-Type'], 'application/x-www-form-urlencoded');
  } else {
    assert.equal(u.origin, 'https://www.googleapis.com');
    assert.equal(u.pathname, '/drive/v3/files/' + fileId);
    assert.equal(init.method, 'GET'); assert.equal(u.searchParams.get('supportsAllDrives'), 'true');
    assert.ok(init.headers.Authorization.startsWith('Bearer TOKEN_FICTICIO'));
    if (!u.searchParams.has('alt')) {
      assert.deepEqual(u.searchParams.get('fields').split(','),
        ['id', 'name', 'mimeType', 'modifiedTime', 'size', 'version', 'md5Checksum', 'sha256Checksum', 'trashed', 'capabilities(canDownload)']);
    } else assert.equal(u.searchParams.get('alt'), 'media');
  }
}
function sourceCase({ bytes = bytesFixture, initial = metadata(bytes), final = initial, m2 = final,
    route, provider, ...options } = {}) {
  const time = clock(), calls = [], invalidations = [];
  let metadataReads = 0, downloads = 0, currentToken = secret;
  const tokenProvider = provider ?? {
    getAccessToken: async () => currentToken,
    invalidate: token => { invalidations.push(token); currentToken = secret + '_RENOVADO'; },
  };
  const fetch = async (url, init) => {
    assertRequest(url, init);
    const media = new URL(url).searchParams.get('alt') === 'media';
    const call = { url, init, media, number: calls.length + 1 };
    calls.push(call);
    if (route) { const overridden = await route(call, { time, calls, metadataReads, downloads }); if (overridden) return overridden; }
    if (media) { downloads++; return new Response(bytes); }
    return json([initial, final, m2][metadataReads++]);
  };
  const adapter = sourceModule.createLibroDriveSource({ fileId, tokenProvider, fetch, crypto: webcrypto, ...time, ...options });
  return { adapter, time, calls, invalidations, tokenProvider, stats: () => ({ metadataReads, downloads }) };
}
function providerCase({ raw, credentialPatch, response, fetchOverride, ...options } = {}) {
  const time = clock(), calls = [];
  const fetch = async (url, init) => {
    assertRequest(url, init, true); calls.push({ url, init });
    return fetchOverride ? fetchOverride(url, init, calls.length) :
      response ? response(calls.length) : json({ access_token: secret + '_' + calls.length, expires_in: 3600, token_type: 'Bearer' });
  };
  const provider = tokenModule.createGoogleServiceAccountTokenProvider({ serviceAccountJson: raw ?? JSON.stringify({ ...credential, ...credentialPatch }),
    fetch, crypto: webcrypto, ...time, ...options });
  return { provider, calls, time };
}
function assertSafe(error) {
  assert.ok(error instanceof common.LibroDriveError);
  const serialized = JSON.stringify({ ...error, message: error.message, stack: error.stack });
  for (const value of [secret, 'CUERPO_GOOGLE_SECRETO', credential.private_key, credential.private_key_id,
    credential.client_email, 'ASSERTION_SECRETA', 'HEADER_SECRETO']) assert.ok(!serialized.includes(value), value);
  assert.equal(error.cause, undefined);
}
async function errorCode(action, code, retryable) {
  let captured;
  await assert.rejects(Promise.resolve().then(action), error => {
    captured = error; assertSafe(error); assert.equal(error.code, code);
    if (retryable !== undefined) assert.equal(error.retryable, retryable);
    return true;
  });
  return captured;
}

test('RS256 real con PKCS8 efímero: claims, kid, firma, scope y audiencia fijos', async () => {
  const p = providerCase({ credentialPatch: { token_uri: 'https://atacante.invalid/robar', auth_uri: 'https://atacante.invalid',
    scope: 'drive', sub: 'persona-ficticia@example.test' } });
  assert.equal(await p.provider.getAccessToken(), secret + '_1');
  const form = new URLSearchParams(p.calls[0].init.body);
  assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  const [header, claims, signature] = form.get('assertion').split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { alg: 'RS256', typ: 'JWT', kid: credential.private_key_id });
  assert.deepEqual(JSON.parse(Buffer.from(claims, 'base64url')), { iss: credential.client_email, scope: common.GOOGLE_DRIVE_SCOPE,
    aud: common.GOOGLE_TOKEN_ENDPOINT, iat: epoch / 1000, exp: epoch / 1000 + 300 });
  assert.equal(await webcrypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, Buffer.from(signature, 'base64url'),
    Buffer.from(header + '.' + claims)), true);
  assert.deepEqual(Object.keys(p.provider), ['getAccessToken', 'invalidate']);
  assert.equal(JSON.stringify(p.provider), '{}');
});
test('kid es opcional y el assertion no inventa delegación', async () => {
  const p = providerCase({ credentialPatch: { private_key_id: undefined } }); await p.provider.getAccessToken();
  const parts = new URLSearchParams(p.calls[0].init.body).get('assertion').split('.');
  assert.deepEqual(JSON.parse(Buffer.from(parts[0], 'base64url')), { alg: 'RS256', typ: 'JWT' });
  assert.equal(JSON.parse(Buffer.from(parts[1], 'base64url')).sub, undefined);
});
for (const [label, raw] of [['JSON inválido', 'CUERPO_GOOGLE_SECRETO'], ['null', 'null'], ['array', '[]'],
  ['objeto vacío', '{}'], ['JSON excesivo', ' '.repeat(32769)]]) {
  test('credencial rechazada: ' + label, async () => { await errorCode(() => providerCase({ raw }), 'CONFIG_INVALIDA', false); });
}
for (const [label, patch] of [['tipo OAuth humano', { type: 'authorized_user' }], ['email ausente', { client_email: undefined }],
  ['email no cuenta de servicio', { client_email: 'ficticio@example.test' }], ['email con CRLF', { client_email: 'HEADER_SECRETO\r\nx' }],
  ['clave ausente', { private_key: undefined }], ['clave PEM inválida', { private_key: 'ASSERTION_SECRETA' }],
  ['PKCS8 DER inválido', { private_key: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----' }],
  ['kid vacío', { private_key_id: '' }], ['kid no string', { private_key_id: 123 }]]) {
  test('credencial estricta: ' + label, async () => {
    await errorCode(async () => { const p = providerCase({ credentialPatch: patch }); await p.provider.getAccessToken(); }, 'CONFIG_INVALIDA', false);
  });
}
test('rechaza una clave RSA inferior a 2048 bits antes de hacer HTTP', async () => {
  const pair = await webcrypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 1024,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const encoded = Buffer.from(await webcrypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
  const p = providerCase({ credentialPatch: { private_key: `-----BEGIN PRIVATE KEY-----\n${encoded}\n-----END PRIVATE KEY-----` } });
  await errorCode(() => p.provider.getAccessToken(), 'CONFIG_INVALIDA'); assert.equal(p.calls.length, 0);
});
test('assertion no permite más de una hora', async () => {
  await errorCode(() => providerCase({ assertionLifetimeSeconds: 3601 }), 'CONFIG_INVALIDA');
});
test('token en memoria, refresh anticipado y expiración real sin reutilizar el viejo', async () => {
  const p = providerCase();
  assert.equal(await p.provider.getAccessToken(), secret + '_1');
  p.time.advance(3_539_999); assert.equal(await p.provider.getAccessToken(), secret + '_1');
  p.time.advance(1); assert.equal(await p.provider.getAccessToken(), secret + '_2');
  p.time.advance(3_600_000); assert.equal(await p.provider.getAccessToken(), secret + '_3');
  assert.equal(p.calls.length, 3);
});
test('tres consumidores comparten una sola adquisición de token en vuelo', async () => {
  const started = deferred(), release = deferred();
  const p = providerCase({ fetchOverride: async () => { started.resolve(); await release.promise; return json({ access_token: secret, expires_in: 3600 }); } });
  const promises = [p.provider.getAccessToken(), p.provider.getAccessToken(), p.provider.getAccessToken()];
  await started.promise; assert.equal(p.calls.length, 1); release.resolve();
  assert.deepEqual(await Promise.all(promises), [secret, secret, secret]);
});
test('un 401 tardío del token viejo no elimina el token nuevo', async () => {
  const p = providerCase(); const old = await p.provider.getAccessToken();
  p.provider.invalidate(old); const current = await p.provider.getAccessToken();
  p.provider.invalidate(old); assert.equal(await p.provider.getAccessToken(), current); assert.equal(p.calls.length, 2);
});
for (const [label, body] of [['sin access_token', { expires_in: 3600 }], ['token vacío', { access_token: '', expires_in: 3600 }],
  ['header injection', { access_token: 'TOKEN\r\nHEADER_SECRETO', expires_in: 3600 }],
  ['token vencido', { access_token: secret, expires_in: 0 }], ['expires negativo', { access_token: secret, expires_in: -1 }],
  ['expires string', { access_token: secret, expires_in: '3600' }], ['tipo incorrecto', { access_token: secret, expires_in: 3600, token_type: 'Other' }],
  ['scope incorrecto', { access_token: secret, expires_in: 3600, scope: 'drive' }]]) {
  test('respuesta OAuth inválida: ' + label, async () => {
    const p = providerCase({ response: () => json(body) }); await errorCode(() => p.provider.getAccessToken(), 'GOOGLE_AUTH_ERROR', false);
    assert.equal(p.calls.length, 1);
  });
}
test('OAuth 400 no filtra la descripción y no se reintenta', async () => {
  const p = providerCase({ response: () => json({ error_description: 'CUERPO_GOOGLE_SECRETO' }, 400) });
  await errorCode(() => p.provider.getAccessToken(), 'GOOGLE_AUTH_ERROR'); assert.equal(p.calls.length, 1);
});
test('OAuth JSON malformado se convierte en error fijo', async () => {
  const p = providerCase({ response: () => new Response('CUERPO_GOOGLE_SECRETO') }); await errorCode(() => p.provider.getAccessToken(), 'GOOGLE_AUTH_ERROR');
});
test('OAuth con cuerpo excesivo se rechaza sin filtrar contenido', async () => {
  const p = providerCase({ response: () => new Response('CUERPO_GOOGLE_SECRETO'.repeat(3000)) }); await errorCode(() => p.provider.getAccessToken(), 'GOOGLE_AUTH_ERROR');
});
test('latencia consume vigencia del token; no se acepta un token ya vencido al llegar', async () => {
  let p;
  p = providerCase({ response: () => { p.time.advance(2000); return json({ access_token: secret, expires_in: 1 }); } });
  await errorCode(() => p.provider.getAccessToken(), 'GOOGLE_AUTH_ERROR');
});

test('R1: transport usa sleep A aunque el objeto original cambie a sleep B', async () => {
  const time = clock(), used = [];
  const options = { ...time, sleep: async ms => { used.push('A'); time.advance(ms); } };
  const transport = common.createGoogleTransport(options);
  options.sleep = async () => { used.push('B'); };
  assert.equal(await transport.retry(transport.operation(), 0, new common.LibroDriveError('GOOGLE_RATE_LIMIT')), true);
  assert.deepEqual(used, ['A']);
});

test('R1: todas las opciones de red se leen sólo al construir el transport', async () => {
  const time = clock(), used = [], options = { ...time, fetch: async () => { used.push('fetch'); return json({ ok: true }); },
    setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: handle => clearTimeout(handle),
    budgetMs: 5000, maxRetries: 1, retryDelayMs: 250 };
  Object.defineProperty(options, 'serviceAccountJson', { get() { assert.fail('El transport no debe leer la credencial'); } });
  const transport = common.createGoogleTransport(options);
  for (const name of ['fetch', 'now', 'sleep', 'random', 'setTimer', 'clearTimer', 'budgetMs', 'maxRetries', 'retryDelayMs'])
    Object.defineProperty(options, name, { get() { assert.fail('Lectura tardía de opción: ' + name); } });
  const op = transport.operation();
  assert.equal(await transport.retry(op, 0, new common.LibroDriveError('GOOGLE_RATE_LIMIT')), true);
  const value = await transport.request(common.GOOGLE_TOKEN_ENDPOINT, { method: 'POST' }, 1000, op,
    (response, signal) => common.readJson(response, signal, 'GOOGLE_AUTH_ERROR'));
  assert.deepEqual(value, { ok: true }); assert.deepEqual(time.sleeps, [250]); assert.deepEqual(used, ['fetch']);
});

test('R1: provider reintenta y refresca sin volver a leer opciones ni JSON de credencial', async () => {
  const time = clock(), used = []; let requests = 0;
  const options = { serviceAccountJson: JSON.stringify(credential), crypto: webcrypto, ...time,
    sleep: async ms => { used.push('A'); time.advance(ms); }, fetch: async (url, init) => {
      assertRequest(url, init, true); requests++;
      return requests % 2 ? json({}, 503) : json({ access_token: secret + '_' + requests, expires_in: 3600 });
    } };
  const provider = tokenModule.createGoogleServiceAccountTokenProvider(options);
  options.sleep = async () => { used.push('B'); };
  for (const name of ['serviceAccountJson', 'fetch', 'now', 'random', 'crypto', 'tokenTimeoutMs', 'assertionLifetimeSeconds'])
    Object.defineProperty(options, name, { get() { assert.fail('Lectura tardía del provider: ' + name); } });
  assert.equal(await provider.getAccessToken(), secret + '_2');
  time.advance(3600000);
  assert.equal(await provider.getAccessToken(), secret + '_4');
  assert.equal(requests, 4); assert.deepEqual(used, ['A', 'A']);
});

function google403(reason) {
  return { error: { code: 403, message: 'CUERPO_GOOGLE_SECRETO ' + secret,
    errors: [{ domain: 'usageLimits', reason, message: 'CUERPO_GOOGLE_SECRETO ' + secret }] } };
}
for (const reason of ['rateLimitExceeded', 'userRateLimitExceeded']) {
  test('R1: Drive 403 ' + reason + ' reintenta y entrega la fuente estable', async () => {
    const f = sourceCase({ route: call => call.number === 1 ? json(google403(reason), 403) : null });
    const source = await f.adapter.obtain(); await f.adapter.verifyStillCurrent(source.stamp);
    assert.deepEqual(Buffer.from(source.bytes), bytesFixture); assert.deepEqual(f.time.sleeps, [250]);
    assert.equal(f.calls.length, 5); assert.equal(f.stats().downloads, 1); assert.equal(f.invalidations.length, 0);
    assert.ok(!JSON.stringify(source).includes('CUERPO_GOOGLE_SECRETO'));
  });
  test('R1: Drive 403 ' + reason + ' persistente aborta al agotar el retry', async () => {
    const f = sourceCase({ route: () => json(google403(reason), 403) });
    await errorCode(() => f.adapter.obtain(), 'GOOGLE_RATE_LIMIT', true);
    assert.equal(f.calls.length, 2); assert.deepEqual(f.time.sleeps, [250]); assert.equal(f.stats().downloads, 0);
    assert.equal(f.invalidations.length, 0);
  });
}
test('R1: 403 rate-limit conserva backoff exponencial y máximo configurable', async () => {
  const f = sourceCase({ maxRetries: 2, route: () => json(google403('rateLimitExceeded'), 403) });
  await errorCode(() => f.adapter.obtain(), 'GOOGLE_RATE_LIMIT', true);
  assert.equal(f.calls.length, 3); assert.deepEqual(f.time.sleeps, [250, 500]);
});

const denied403 = [
  ['permiso normal aunque message contenga el nombre del rate limit', { error: { code: 403,
    message: 'rateLimitExceeded userRateLimitExceeded CUERPO_GOOGLE_SECRETO', errors: [{ reason: 'insufficientFilePermissions' }] } }],
  ['reason en raíz', { reason: 'rateLimitExceeded' }],
  ['reason fuera de errors', { error: { reason: 'rateLimitExceeded' } }],
  ['sólo message', { error: { message: 'rateLimitExceeded' } }],
  ['campo desconocido', { error: { details: [{ reason: 'rateLimitExceeded' }] } }],
  ['errors como objeto', { error: { errors: { reason: 'rateLimitExceeded' } } }],
  ['entrada errors como string', { error: { errors: ['rateLimitExceeded'] } }],
  ['reason en objeto anidado', { error: { errors: [{ details: { reason: 'rateLimitExceeded' } }] } }],
  ['substring reason', google403('rateLimitExceededExtra')],
  ['reason con espacios', google403(' rateLimitExceeded ')],
  ['reason con mayúsculas distintas', google403('RateLimitExceeded')],
  ['otra cuota fuera de whitelist', google403('dailyLimitExceeded')],
  ['reason no string', google403(['rateLimitExceeded'])],
  ['error como array', { error: [{ errors: [{ reason: 'rateLimitExceeded' }] }] }],
  ['raíz como array', [google403('rateLimitExceeded')]],
];
for (const [label, body] of denied403) {
  test('R1: 403 bloqueado sin retry: ' + label, async () => {
    const f = sourceCase({ route: () => json(body, 403) });
    await errorCode(() => f.adapter.obtain(), 'GOOGLE_ACCESS_DENIED', false);
    assert.equal(f.calls.length, 1); assert.deepEqual(f.time.sleeps, []); assert.equal(f.invalidations.length, 0);
  });
}
test('R1: reason reconocido en otro elemento estructurado de errors activa rate limit', async () => {
  const body = google403('userRateLimitExceeded'); body.error.errors.unshift({ reason: 'insufficientFilePermissions' });
  const f = sourceCase({ route: () => json(body, 403) });
  await errorCode(() => f.adapter.obtain(), 'GOOGLE_RATE_LIMIT', true); assert.equal(f.calls.length, 2);
});
for (const [label, bytes] of [['JSON inválido', Buffer.from('CUERPO_GOOGLE_SECRETO ' + secret)], ['UTF8 inválido', Buffer.from([0xff])]]) {
  test('R1: 403 ' + label + ' conserva ACCESS_DENIED sin filtrar contenido', async () => {
    const f = sourceCase({ route: () => new Response(bytes, { status: 403 }) });
    await errorCode(() => f.adapter.obtain(), 'GOOGLE_ACCESS_DENIED', false); assert.equal(f.calls.length, 1);
  });
}
test('R1: body 403 exactamente 32 KiB se puede clasificar sin exponerlo', async () => {
  const body = JSON.stringify(google403('rateLimitExceeded')).padEnd(32768, ' ');
  const f = sourceCase({ maxRetries: 0, route: () => new Response(body, { status: 403 }) });
  await errorCode(() => f.adapter.obtain(), 'GOOGLE_RATE_LIMIT', true); assert.equal(f.calls.length, 1);
});
test('R1: body 403 sobre 32 KiB se cancela y bloquea aunque incluya reason válido', async () => {
  let cancelled = false;
  const f = sourceCase({ route: () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(Buffer.from(JSON.stringify(google403('rateLimitExceeded')))); controller.enqueue(new Uint8Array(32769)); },
    cancel() { cancelled = true; },
  }), { status: 403 }) });
  await errorCode(() => f.adapter.obtain(), 'GOOGLE_ACCESS_DENIED', false);
  assert.equal(cancelled, true); assert.equal(f.calls.length, 1); assert.deepEqual(f.time.sleeps, []);
});
test('R1: error externo al leer body 403 queda descartado y no se propaga', async () => {
  const f = sourceCase({ route: () => new Response(new ReadableStream({
    start(controller) { controller.error(new Error('CUERPO_GOOGLE_SECRETO ' + secret)); },
  }), { status: 403 }) });
  await errorCode(() => f.adapter.obtain(), 'GOOGLE_ACCESS_DENIED', false); assert.equal(f.calls.length, 1);
});
test('R1: body 403 que no termina está sujeto al timeout y cancelación de metadata', async () => {
  const time = clock(), timers = manualTimers(time); let cancelled = false;
  const f = sourceCase({ ...time, ...timers, route: () => new Response(new ReadableStream({
    pull() { queueMicrotask(() => timers.fireLast()); }, cancel() { cancelled = true; },
  }), { status: 403 }) });
  await errorCode(() => f.adapter.obtain(), 'GOOGLE_TIMEOUT');
  assert.equal(cancelled, true); assert.equal(timers.active.size, 0); assert.equal(f.calls.length, 1);
});
for (const phase of ['M1', 'M2']) {
  test('R1: 403 rate-limit de ' + phase + ' reintenta sólo metadata, sin otra descarga', async () => {
    const f = sourceCase({ route: call => call.number === (phase === 'M1' ? 3 : 4) ? json(google403('rateLimitExceeded'), 403) : null });
    const source = await f.adapter.obtain(); await f.adapter.verifyStillCurrent(source.stamp);
    assert.equal(f.stats().downloads, 1); assert.deepEqual(f.time.sleeps, [250]); assert.equal(f.calls.length, 5);
  });
}
test('R1: 403 rate-limit respeta Retry-After y presupuesto existente', async () => {
  const f = sourceCase({ route: call => call.number === 1 ? json(google403('rateLimitExceeded'), 403, { 'Retry-After': '1' }) : null });
  await f.adapter.obtain(); assert.deepEqual(f.time.sleeps, [1000]);
  const exhausted = sourceCase({ budgetMs: 500, route: () => json(google403('rateLimitExceeded'), 403, { 'Retry-After': '1' }) });
  await errorCode(() => exhausted.adapter.obtain(), 'GOOGLE_TIMEOUT'); assert.equal(exhausted.calls.length, 1);
});
test('R1: OAuth 403 con reason rate-limit no se inspecciona ni cambia su clasificación', async () => {
  let reads = 0;
  const p = providerCase({ response: () => {
    const response = json(google403('rateLimitExceeded'), 403);
    response.body.getReader = () => { reads++; throw new Error('CUERPO_GOOGLE_SECRETO'); };
    return response;
  } });
  await errorCode(() => p.provider.getAccessToken(), 'GOOGLE_AUTH_ERROR', false);
  assert.equal(reads, 0); assert.equal(p.calls.length, 1); assert.deepEqual(p.time.sleeps, []);
});

test('M0/M1/M2 estable: bytes íntegros, int64 string, hashes y un solo GET media', async () => {
  const f = sourceCase(); const source = await f.adapter.obtain(); await f.adapter.verifyStillCurrent(source.stamp);
  assert.deepEqual(Buffer.from(source.bytes), bytesFixture);
  assert.equal(source.sha256, hash('sha256', bytesFixture)); assert.equal(source.metadata.driveVersion, '9223372036854775807');
  assert.equal(source.verifiedAt, new Date(epoch).toISOString());
  assert.deepEqual(f.stats(), { metadataReads: 3, downloads: 1 });
  assert.equal(source.metadata.id, undefined); assert.equal(source.metadata.fileId, undefined);
  assert.ok(Object.isFrozen(source) && Object.isFrozen(source.metadata) && Object.isFrozen(source.stamp));
  assert.ok(!JSON.stringify(source).includes(secret));
  assert.deepEqual(Object.keys(f.adapter), ['obtain', 'verifyStillCurrent']);
});
test('flujo completo con PKCS8 efímero + OAuth falso + XLSX versionado anonimizado', async () => {
  const bytes = fs.readFileSync(path.join(__dirname, 'fixtures/libro-reconciliacion-oct26-real.xlsx'));
  const time = clock(), calls = [];
  const fetch = async (url, init) => {
    const oauth = url === common.GOOGLE_TOKEN_ENDPOINT; assertRequest(url, init, oauth); calls.push({ url, init });
    if (oauth) return json({ access_token: secret, expires_in: 3600 });
    return new URL(url).searchParams.has('alt') ? new Response(bytes) : json(metadata(bytes));
  };
  const provider = tokenModule.createGoogleServiceAccountTokenProvider({ serviceAccountJson: JSON.stringify(credential), fetch, crypto: webcrypto, ...time });
  const adapter = sourceModule.createLibroDriveSource({ fileId, tokenProvider: provider, fetch, crypto: webcrypto, ...time });
  const source = await adapter.obtain(); await adapter.verifyStillCurrent(source.stamp);
  assert.deepEqual(Buffer.from(source.bytes), bytes); assert.equal(source.sha256, hash('sha256', bytes));
  assert.equal(calls.filter(c => c.url === common.GOOGLE_TOKEN_ENDPOINT).length, 1);
  assert.equal(calls.filter(c => c.url.includes('alt=media')).length, 1);
  assert.equal(calls.filter(c => c.init.method === 'GET' && !c.url.includes('alt=media')).length, 3);
  assert.ok(!JSON.stringify(source).includes(secret));
});
for (const [label, patch, code] of [['ID incorrecto', { id: 'otro-libro' }, 'FUENTE_INVALIDA'],
  ['MIME incorrecto', { mimeType: 'application/vnd.google-apps.spreadsheet' }, 'FUENTE_INVALIDA'],
  ['archivo eliminado', { trashed: true }, 'FUENTE_INVALIDA'], ['trashed no boolean', { trashed: 'true' }, 'FUENTE_INVALIDA'],
  ['descarga prohibida', { capabilities: { canDownload: false } }, 'FUENTE_INVALIDA'],
  ['capacidad ausente', { capabilities: {} }, 'FUENTE_INVALIDA'], ['nombre no string', { name: 5 }, 'FUENTE_INVALIDA'],
  ['version number inseguro', { version: 9223372036854775807 }, 'FUENTE_INVALIDA'],
  ['version fuera de int64', { version: '9223372036854775808' }, 'FUENTE_INVALIDA'],
  ['version no decimal', { version: '1e20' }, 'FUENTE_INVALIDA'], ['fecha malformada', { modifiedTime: 'ayer' }, 'FUENTE_INVALIDA'],
  ['size ausente', { size: undefined }, 'FUENTE_INVALIDA'], ['size numérico', { size: 15 }, 'FUENTE_INVALIDA'],
  ['size cero', { size: '0' }, 'FUENTE_INVALIDA'], ['size negativo', { size: '-1' }, 'FUENTE_INVALIDA'],
  ['size enorme', { size: '9223372036854775807' }, 'FUENTE_DEMASIADO_GRANDE'],
  ['size supera 8 MiB', { size: String(8 * 1024 * 1024 + 1) }, 'FUENTE_DEMASIADO_GRANDE'],
  ['MD5 malformado', { md5Checksum: 'HASH_SECRETO' }, 'FUENTE_INVALIDA'],
  ['SHA malformado', { sha256Checksum: '0' }, 'FUENTE_INVALIDA'],
  ['sin checksums', { md5Checksum: undefined, sha256Checksum: undefined }, 'FUENTE_NO_VERIFICABLE']]) {
  test('M0 rechazada antes de descargar: ' + label, async () => {
    const f = sourceCase({ initial: metadata(bytesFixture, patch) }); await errorCode(() => f.adapter.obtain(), code);
    assert.equal(f.calls.filter(c => c.media).length, 0);
  });
}
test('nombre/extensión no determinan identidad; MIME y checksum sí', async () => {
  const f = sourceCase({ initial: metadata(bytesFixture, { name: 'Libro sin extensión' }) }); assert.equal((await f.adapter.obtain()).metadata.name, 'Libro sin extensión');
});
test('acepta modifiedTime ausente usando version y checksum remoto verificables', async () => {
  const f = sourceCase({ initial: metadata(bytesFixture, { modifiedTime: undefined, trashed: undefined }) });
  const source = await f.adapter.obtain(); assert.equal(source.metadata.modifiedTime, null); await f.adapter.verifyStillCurrent(source.stamp);
});
test('configuración fileId impide URLs, traversal y query strings', async () => {
  for (const id of ['https://atacante.invalid', '../otro', 'id?alt=media', 'id%2Fotro', '', null])
    await errorCode(() => sourceCase({ fileId: id }), 'CONFIG_INVALIDA');
});
test('límite internamente configurable sin aceptar opciones de request', async () => {
  const f = sourceCase({ maxBytes: bytesFixture.length - 1 }); await errorCode(() => f.adapter.obtain(), 'FUENTE_DEMASIADO_GRANDE');
  const invalid = sourceCase({ maxBytes: bytesFixture.length }); assert.deepEqual(Buffer.from((await invalid.adapter.obtain()).bytes), bytesFixture);
});
test('límite interno reducido a 5 MiB conserva borde exacto y rechazo de exceso', async () => {
  const bytes = Buffer.alloc(5 * 1024 * 1024, 42);
  const f = sourceCase({ bytes, maxBytes: bytes.length }); assert.equal((await f.adapter.obtain()).bytes.length, bytes.length);
  const tooLarge = sourceCase({ maxBytes: bytes.length, initial: metadata(bytes, { size: String(bytes.length + 1) }) });
  await errorCode(() => tooLarge.adapter.obtain(), 'FUENTE_DEMASIADO_GRANDE'); assert.equal(tooLarge.stats().downloads, 0);
});
const reportedOperationalBytes = 6656601, proposedOperationalLimit = 8 * 1024 * 1024;
test('Límite operativo: el tamaño reportado del Libro queda bloqueado con la configuración anterior de 5 MiB', async () => {
  const f = sourceCase({ maxBytes: 5 * 1024 * 1024, initial: metadata(bytesFixture, { size: String(reportedOperationalBytes) }) });
  await errorCode(() => f.adapter.obtain(), 'FUENTE_DEMASIADO_GRANDE', false);
  assert.equal(f.stats().downloads, 0); assert.equal(f.calls.length, 1);
});
test('Límite operativo: default acepta bytes ficticios del tamaño reportado 6.656.601 con hashes y M0/M1/M2', async () => {
  // Generated bytes test transport capacity only; they are not the real Drive XLSX.
  const bytes = Buffer.alloc(reportedOperationalBytes, 42);
  const f = sourceCase({ bytes, route: call => call.media ? new Response(bytes,
    { headers: { 'Content-Length': String(bytes.length) } }) : null });
  const source = await f.adapter.obtain(); await f.adapter.verifyStillCurrent(source.stamp);
  assert.equal(sourceModule.LIBRO_MAX_COMPRESSED_BYTES, proposedOperationalLimit);
  assert.deepEqual(Buffer.from(source.bytes), bytes); assert.equal(source.sha256, hash('sha256', bytes));
  assert.equal(source.metadata.md5Checksum, hash('md5', bytes)); assert.equal(source.metadata.size, reportedOperationalBytes);
  assert.equal(f.stats().metadataReads, 3); assert.equal(f.calls.filter(call => call.media).length, 1);
  assert.equal(f.calls.length, 4);
});
test('Límite operativo: default acepta exactamente 8 MiB con Content-Length y checksums válidos', async () => {
  const bytes = Buffer.alloc(proposedOperationalLimit, 31);
  const f = sourceCase({ bytes, route: call => call.media ? new Response(bytes,
    { headers: { 'Content-Length': String(bytes.length) } }) : null });
  const source = await f.adapter.obtain(); await f.adapter.verifyStillCurrent(source.stamp);
  assert.equal(source.bytes.byteLength, proposedOperationalLimit); assert.deepEqual(Buffer.from(source.bytes), bytes);
  assert.equal(source.sha256, hash('sha256', bytes)); assert.equal(source.metadata.md5Checksum, hash('md5', bytes));
  assert.equal(f.stats().metadataReads, 3); assert.equal(f.calls.filter(call => call.media).length, 1);
  assert.equal(f.calls.length, 4);
});
test('Límite operativo: metadata 8 MiB + 1 aborta antes de cualquier descarga', async () => {
  const f = sourceCase({ initial: metadata(bytesFixture, { size: String(proposedOperationalLimit + 1) }) });
  await errorCode(() => f.adapter.obtain(), 'FUENTE_DEMASIADO_GRANDE', false);
  assert.equal(f.calls.length, 1); assert.equal(f.stats().downloads, 0);
});
for (const declaredLength of [null, String(proposedOperationalLimit)]) {
  test('Límite operativo: stream 8 MiB + 1 se cancela con Content-Length ' + (declaredLength === null ? 'ausente' : 'falso'), async () => {
    let cancelled = false;
    const f = sourceCase({ initial: metadata(bytesFixture, { size: String(proposedOperationalLimit) }),
      route: call => call.media ? new Response(new ReadableStream({
        start(controller) { controller.enqueue(new Uint8Array(proposedOperationalLimit)); controller.enqueue(new Uint8Array(1)); },
        cancel() { cancelled = true; },
      }), { headers: declaredLength === null ? {} : { 'Content-Length': declaredLength } }) : null });
    await errorCode(() => f.adapter.obtain(), 'FUENTE_DEMASIADO_GRANDE', false);
    assert.equal(cancelled, true); assert.equal(f.calls.filter(call => call.media).length, 1);
    assert.equal(f.stats().metadataReads, 1); assert.equal(f.calls.length, 2);
  });
}

test('el stream real se limita incluso si metadata y Content-Length mienten', async () => {
  let cancelled = false;
  const f = sourceCase({ maxBytes: 15, route: call => call.media ? new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(16)); }, cancel() { cancelled = true; },
  }), { headers: { 'Content-Length': '15' } }) : null });
  await errorCode(() => f.adapter.obtain(), 'FUENTE_DEMASIADO_GRANDE'); assert.equal(cancelled, true); assert.equal(f.stats().metadataReads, 1);
});
test('archivo vacío y tamaño real distinto de metadata bloquean la fuente', async () => {
  for (const bytes of [Buffer.alloc(0), bytesFixture.subarray(1)]) {
    const f = sourceCase({ route: call => call.media ? new Response(bytes) : null }); await errorCode(() => f.adapter.obtain(), 'FUENTE_INVALIDA');
    assert.equal(f.calls.filter(c => c.media).length, 1);
  }
});
for (const [label, length, code] of [['distinto de metadata', '14', 'FUENTE_INVALIDA'],
  ['supera límite', String(8 * 1024 * 1024 + 1), 'FUENTE_DEMASIADO_GRANDE'], ['malformado', 'HEADER_SECRETO', 'FUENTE_INVALIDA']]) {
  test('Content-Length: ' + label, async () => {
    const f = sourceCase({ route: call => call.media ? new Response(bytesFixture, { headers: { 'Content-Length': length } }) : null });
    await errorCode(() => f.adapter.obtain(), code);
  });
}
test('Content-Length identity válido; encoding gzip no se confunde con tamaño XLSX decodificado', async () => {
  for (const headers of [{ 'Content-Length': '15' }, { 'Content-Length': '8', 'Content-Encoding': 'gzip' }]) {
    const f = sourceCase({ route: call => call.media ? new Response(bytesFixture, { headers }) : null });
    assert.deepEqual(Buffer.from((await f.adapter.obtain()).bytes), bytesFixture);
  }
});
for (const [label, patch] of [['MD5 solamente', { sha256Checksum: undefined }], ['SHA256 solamente', { md5Checksum: undefined }],
  ['checksums hex mayúscula', { md5Checksum: hash('md5', bytesFixture).toUpperCase(), sha256Checksum: hash('sha256', bytesFixture).toUpperCase() }]]) {
  test('verificación remota válida: ' + label, async () => {
    const f = sourceCase({ initial: metadata(bytesFixture, patch) }); assert.equal((await f.adapter.obtain()).sha256, hash('sha256', bytesFixture));
  });
}
for (const [label, patch] of [['MD5 incorrecto aun con SHA correcto', { md5Checksum: '0'.repeat(32) }],
  ['SHA incorrecto aun con MD5 correcto', { sha256Checksum: '0'.repeat(64) }],
  ['MD5 solamente incorrecto', { sha256Checksum: undefined, md5Checksum: '0'.repeat(32) }]]) {
  test('checksum contradictorio: ' + label, async () => {
    const f = sourceCase({ initial: metadata(bytesFixture, patch) }); await errorCode(() => f.adapter.obtain(), 'CHECKSUM_INVALIDO', false);
    assert.equal(f.stats().metadataReads, 1); assert.equal(f.calls.filter(c => c.media).length, 1);
  });
}
const changes = [ ['id', { id: 'otro' }], ['mimeType', { mimeType: 'text/plain' }], ['version', { version: '2' }],
  ['modifiedTime', { modifiedTime: '2026-10-09T11:01:00Z' }], ['size', { size: '16' }],
  ['md5Checksum', { md5Checksum: '0'.repeat(32) }], ['sha256Checksum', { sha256Checksum: '0'.repeat(64) }],
  ['canDownload', { capabilities: { canDownload: false } }], ['trashed', { trashed: true }],
  ['checksums desaparecen', { md5Checksum: undefined, sha256Checksum: undefined }], ['metadata inválida', { version: 5 }],
];
for (const [label, patch] of changes) {
  test('M1 cambió ' + label + ': no se entregan bytes válidos', async () => {
    const f = sourceCase({ final: metadata(bytesFixture, patch) }); await errorCode(() => f.adapter.obtain(), 'FUENTE_CAMBIADA', true);
    assert.equal(f.calls.filter(c => c.media).length, 1); assert.equal(f.calls.length, 3);
  });
  test('M2 cambió ' + label + ': descartar comparación, sin segunda descarga', async () => {
    const f = sourceCase({ m2: metadata(bytesFixture, patch) }); const source = await f.adapter.obtain();
    await errorCode(() => f.adapter.verifyStillCurrent(source.stamp), 'FUENTE_CAMBIADA', true);
    assert.equal(f.calls.filter(c => c.media).length, 1); assert.equal(f.calls.length, 4);
  });
}
test('M2 rechaza stamp reconstruido o de otro adaptador antes de hacer HTTP', async () => {
  const f = sourceCase(), other = sourceCase(); const source = await f.adapter.obtain();
  await errorCode(() => f.adapter.verifyStillCurrent({ ...source.stamp }), 'CONFIG_INVALIDA');
  await errorCode(() => other.adapter.verifyStillCurrent(source.stamp), 'CONFIG_INVALIDA'); assert.equal(other.calls.length, 0);
});
test('401 renueva una vez y permite terminar M0/M1/M2', async () => {
  const f = sourceCase({ route: call => call.number === 1 ? json({ error: 'CUERPO_GOOGLE_SECRETO' }, 401) : null });
  const source = await f.adapter.obtain(); await f.adapter.verifyStillCurrent(source.stamp);
  assert.equal(f.invalidations.length, 1); assert.equal(f.calls.length, 5); assert.equal(f.stats().downloads, 1);
});
test('segundo 401 aborta: cero loops de renovación', async () => {
  const f = sourceCase({ route: () => json({ error: 'CUERPO_GOOGLE_SECRETO' }, 401) });
  await errorCode(() => f.adapter.obtain(), 'GOOGLE_AUTH_ERROR', false); assert.equal(f.calls.length, 2); assert.equal(f.invalidations.length, 1);
});
test('el presupuesto de renovación 401 es compartido por toda la adquisición', async () => {
  const f = sourceCase({ route: call => call.number === 1 || call.media ? json({}, 401) : null });
  await errorCode(() => f.adapter.obtain(), 'GOOGLE_AUTH_ERROR'); assert.equal(f.calls.length, 3); assert.equal(f.invalidations.length, 1);
});
test('401 antes de descargar no cuenta como descarga completa; un único cuerpo exitoso', async () => {
  let attempts = 0;
  const f = sourceCase({ route: call => call.media && ++attempts === 1 ? json({}, 401) : null });
  const source = await f.adapter.obtain(); assert.deepEqual(Buffer.from(source.bytes), bytesFixture);
  assert.equal(attempts, 2); assert.equal(f.stats().downloads, 1); assert.equal(f.invalidations.length, 1);
});
for (const [status, code] of [[403, 'GOOGLE_ACCESS_DENIED'], [404, 'GOOGLE_FILE_NOT_FOUND']]) {
  test('Drive ' + status + ' no se reintenta ni filtra cuerpo', async () => {
    const f = sourceCase({ route: () => json({ message: 'CUERPO_GOOGLE_SECRETO' }, status) });
    await errorCode(() => f.adapter.obtain(), code, false); assert.equal(f.calls.length, 1); assert.equal(f.invalidations.length, 0);
  });
}
for (const [status, code] of [[429, 'GOOGLE_RATE_LIMIT'], [500, 'GOOGLE_TEMPORARY_ERROR'], [502, 'GOOGLE_TEMPORARY_ERROR'], [503, 'GOOGLE_TEMPORARY_ERROR']]) {
  test('Drive ' + status + ': un retry acotado y luego éxito', async () => {
    const f = sourceCase({ route: call => call.number === 1 ? json({}, status) : null });
    await f.adapter.obtain(); assert.equal(f.calls.length, 4); assert.deepEqual(f.time.sleeps, [250]); assert.equal(f.stats().downloads, 1);
  });
  test('Drive ' + status + ' persistente: dos intentos y error seguro', async () => {
    const f = sourceCase({ route: () => json({ error: 'CUERPO_GOOGLE_SECRETO' }, status) });
    await errorCode(() => f.adapter.obtain(), code, true); assert.equal(f.calls.length, 2); assert.deepEqual(f.time.sleeps, [250]);
  });
}
test('retry de M1 no vuelve a descargar los bytes ya verificados', async () => {
  const f = sourceCase({ route: call => call.number === 3 ? json({}, 503) : null }); await f.adapter.obtain();
  assert.equal(f.stats().downloads, 1); assert.equal(f.calls.length, 4);
});
test('M2 403 conserva bloqueo y no usa la metadata anterior como fallback', async () => {
  const f = sourceCase({ route: call => call.number === 4 ? json({}, 403) : null }); const source = await f.adapter.obtain();
  await errorCode(() => f.adapter.verifyStillCurrent(source.stamp), 'GOOGLE_ACCESS_DENIED'); assert.equal(f.stats().downloads, 1);
});
test('Retry-After y presupuesto total se respetan sin esperas reales', async () => {
  const f = sourceCase({ route: call => call.number === 1 ? json({}, 429, { 'Retry-After': '1' }) : null });
  await f.adapter.obtain(); assert.deepEqual(f.time.sleeps, [1000]);
  const exhausted = sourceCase({ budgetMs: 500, route: () => json({}, 429, { 'Retry-After': '1' }) });
  await errorCode(() => exhausted.adapter.obtain(), 'GOOGLE_TIMEOUT'); assert.equal(exhausted.calls.length, 1); assert.deepEqual(exhausted.time.sleeps, []);
});
test('fallo de fetch con mensaje sensible queda sanitizado y acotado', async () => {
  const f = sourceCase({ route: () => { throw new Error('HEADER_SECRETO ' + secret); } });
  await errorCode(() => f.adapter.obtain(), 'GOOGLE_TEMPORARY_ERROR'); assert.equal(f.calls.length, 2);
});
test('redirect Drive se rechaza sin seguir Location ni reintentar', async () => {
  const f = sourceCase({ route: () => new Response(null, { status: 302, headers: { Location: 'https://atacante.invalid/' + secret } }) });
  await errorCode(() => f.adapter.obtain(), 'GOOGLE_TEMPORARY_ERROR', false); assert.equal(f.calls.length, 1);
});
test('redirect OAuth tampoco se sigue', async () => {
  const p = providerCase({ response: () => new Response(null, { status: 307, headers: { Location: 'https://atacante.invalid' } }) });
  await errorCode(() => p.provider.getAccessToken(), 'GOOGLE_TEMPORARY_ERROR', false); assert.equal(p.calls.length, 1);
});
for (const phase of ['metadata', 'download']) {
  test('timeout ' + phase + ' aborta fetch, cancela timer y no reintenta', async () => {
    const time = clock(), timers = manualTimers(time); let aborted = false;
    const f = sourceCase({ ...time, ...timers, route: call => {
      if (phase === 'metadata' || call.media) {
        call.init.signal.addEventListener('abort', () => { aborted = true; });
        queueMicrotask(() => timers.fireLast()); return new Promise(() => {});
      }
      return null;
    } });
    await errorCode(() => f.adapter.obtain(), 'GOOGLE_TIMEOUT', true); assert.equal(aborted, true); assert.equal(timers.active.size, 0);
    assert.ok(timers.scheduled.includes(phase === 'metadata' ? 10000 : 20000));
    assert.equal(f.calls.length, phase === 'metadata' ? 1 : 2);
  });
}
test('timeout también cubre el cuerpo de descarga después de recibir headers', async () => {
  const time = clock(), timers = manualTimers(time); let cancelled = false;
  const f = sourceCase({ ...time, ...timers, route: call => call.media ? new Response(new ReadableStream({
    pull() { queueMicrotask(() => timers.fireLast()); }, cancel() { cancelled = true; },
  })) : null });
  await errorCode(() => f.adapter.obtain(), 'GOOGLE_TIMEOUT'); assert.equal(cancelled, true); assert.equal(timers.active.size, 0);
});
test('timeout OAuth incluye su presupuesto y aborta fetch', async () => {
  const time = clock(), timers = manualTimers(time); let aborted = false;
  const p = providerCase({ ...time, ...timers, fetchOverride: async (_url, init) => {
    init.signal.addEventListener('abort', () => { aborted = true; }); queueMicrotask(() => timers.fireLast()); return new Promise(() => {});
  } });
  await errorCode(() => p.provider.getAccessToken(), 'GOOGLE_TIMEOUT'); assert.equal(aborted, true); assert.equal(p.calls.length, 1); assert.equal(timers.active.size, 0);
});
test('source limita también un tokenProvider que no responde', async () => {
  const time = clock(), timers = manualTimers(time);
  const f = sourceCase({ ...time, ...timers, provider: { getAccessToken: () => {
    queueMicrotask(() => timers.fireLast()); return new Promise(() => {});
  }, invalidate() {} } });
  await errorCode(() => f.adapter.obtain(), 'GOOGLE_TIMEOUT'); assert.equal(f.calls.length, 0); assert.equal(timers.active.size, 0);
});
test('retry OAuth 429/5xx se limita sin loops ni esperas reales', async () => {
  for (const status of [429, 503]) {
    const p = providerCase({ response: n => n === 1 ? json({}, status) : json({ access_token: secret, expires_in: 3600 }) });
    assert.equal(await p.provider.getAccessToken(), secret); assert.equal(p.calls.length, 2); assert.deepEqual(p.time.sleeps, [250]);
    const failed = providerCase({ response: () => json({}, status) });
    await errorCode(() => failed.provider.getAccessToken(), status === 429 ? 'GOOGLE_RATE_LIMIT' : 'GOOGLE_TEMPORARY_ERROR');
    assert.equal(failed.calls.length, 2);
  }
});
test('timers y retries son configurables y validados', async () => {
  for (const options of [{ maxRetries: 3 }, { budgetMs: 0 }, { maxBytes: 0 }, { metadataTimeoutMs: 0 }, { downloadTimeoutMs: -1 }])
    await errorCode(() => sourceCase(options), 'CONFIG_INVALIDA');
  const f = sourceCase({ maxRetries: 0, route: () => json({}, 503) });
  await errorCode(() => f.adapter.obtain(), 'GOOGLE_TEMPORARY_ERROR'); assert.equal(f.calls.length, 1);
});
test('ninguna escritura Drive/Proyecto-H ni ejecución de 4B.1 en adquisición/M2', async () => {
  const f = sourceCase(); const source = await f.adapter.obtain(); await f.adapter.verifyStillCurrent(source.stamp);
  assert.equal(f.calls.length, 4); assert.ok(f.calls.every(call => call.init.method === 'GET'));
  for (const filename of ['googleDriveReadonlyCommon.ts', 'googleServiceAccountToken.ts', 'libroDriveChecksums.ts', 'libroDriveSource.ts']) {
    const text = fs.readFileSync(path.join(__dirname, '../supabase/functions/_shared', filename), 'utf8');
    assert.ok(!/Deno\.env|process\.env|console\.|localStorage|IndexedDB|service_role|\.rpc\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(|HAIKU_LIBRO_COMPARACION_READONLY_V1/.test(text), filename);
  }
});
test('MD5: vectores RFC 1321, offsets y fronteras de padding contra node:crypto', () => {
  const vectors = [['', 'd41d8cd98f00b204e9800998ecf8427e'], ['a', '0cc175b9c0f1b6a831c399e269772661'],
    ['abc', '900150983cd24fb0d6963f7d28e17f72'], ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0']];
  for (const [text, expected] of vectors) assert.equal(checksums.md5Hex(Buffer.from(text)), expected);
  for (const length of [1, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1024, 65536]) {
    const bytes = randomBytes(length + 7).subarray(3, length + 3); assert.equal(checksums.md5Hex(bytes), hash('md5', bytes));
  }
});
