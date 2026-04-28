// Cliente HTTP autenticado pra Tuya Cloud API.
// Assinatura HMAC-SHA256 conforme docs:
//   https://developer.tuya.com/en/docs/cloud/api-auth?id=Kb6r0b9yfdn9t
//
// Credenciais: lidas de env vars (nunca hardcoded):
//   TUYA_ACCESS_ID  — Access ID/Client ID do projeto Tuya IoT
//   TUYA_ACCESS_KEY — Access Secret/Client Secret (nunca vaza em logs/response)
//   TUYA_ENDPOINT   — ex: https://openapi.tuyaus.com  (Western America)

const crypto = require('crypto');

const ACCESS_ID  = process.env.TUYA_ACCESS_ID;
const ACCESS_KEY = process.env.TUYA_ACCESS_KEY;
const ENDPOINT   = process.env.TUYA_ENDPOINT || 'https://openapi.tuyaus.com';

function sha256Hex(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

function hmac256Upper(key, str) {
  return crypto.createHmac('sha256', key).update(str, 'utf8').digest('hex').toUpperCase();
}

// Ordena query params lexicograficamente — Tuya exige isso na assinatura
// pra endpoints com múltiplos params (ex: /v2.0/cloud/thing/.../report-logs).
// Sem isso, retorna `sign invalid (code 1004)`.
//
// IMPORTANTE: Tuya espera vírgula LITERAL (sem URL-encoding) em valores CSV
// — ex: `?codes=temp1,temp2`. Se mandar `%2C`, a assinatura HMAC não bate.
// A função encodeURIComponent encoda `,` como `%2C`; substituímos pra vírgula literal.
function sortQueryParams(path) {
  const qIdx = path.indexOf('?');
  if (qIdx < 0) return path;
  const base = path.slice(0, qIdx);
  const query = path.slice(qIdx + 1);
  const params = new URLSearchParams(query);
  const sorted = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const newQuery = sorted.map(([k, v]) => {
    // Tuya quer vírgula literal (não %2C) e dois-pontos literal em alguns campos
    const encoded = encodeURIComponent(v).replace(/%2C/g, ',');
    return `${k}=${encoded}`;
  }).join('&');
  return base + (newQuery ? '?' + newQuery : '');
}

function buildStringToSign(method, urlPathWithQuery, bodyStr = '') {
  const sortedPath = sortQueryParams(urlPathWithQuery);
  const contentHash = sha256Hex(bodyStr);
  const signedHeadersStr = ''; // sem headers opcionais na assinatura
  return `${method.toUpperCase()}\n${contentHash}\n${signedHeadersStr}\n${sortedPath}`;
}

// Cache do access_token em memória. Persiste enquanto o container serverless estiver "hot".
// Tokens Tuya duram ~2h; se o container esfriar, pegamos outro na próxima invocação.
let cachedToken = null;
let cachedTokenExpiresAt = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < cachedTokenExpiresAt - 60_000) {
    return cachedToken;
  }
  if (!ACCESS_ID || !ACCESS_KEY) {
    throw new Error('Faltam env vars TUYA_ACCESS_ID e/ou TUYA_ACCESS_KEY na Vercel');
  }
  const t = Date.now().toString();
  const nonce = crypto.randomUUID();
  const path = '/v1.0/token?grant_type=1';
  const stringToSign = buildStringToSign('GET', path, '');
  // Na requisição de TOKEN não incluímos access_token na string assinada
  const str = ACCESS_ID + t + nonce + stringToSign;
  const sign = hmac256Upper(ACCESS_KEY, str);

  const res = await fetch(ENDPOINT + path, {
    headers: {
      'client_id': ACCESS_ID,
      'sign': sign,
      'sign_method': 'HMAC-SHA256',
      't': t,
      'nonce': nonce,
      'Content-Type': 'application/json',
    },
  });
  const data = await res.json();
  if (!data.success) {
    const err = new Error(`Tuya token error: ${data.msg || 'unknown'} (code ${data.code})`);
    err.tuyaCode = data.code;
    err.tuyaMsg = data.msg;
    throw err;
  }
  cachedToken = data.result.access_token;
  cachedTokenExpiresAt = Date.now() + (data.result.expire_time * 1000);
  return cachedToken;
}

async function tuyaRequest(method, path, body = null) {
  const accessToken = await getAccessToken();
  const t = Date.now().toString();
  const nonce = crypto.randomUUID();
  const bodyStr = body ? JSON.stringify(body) : '';
  // IMPORTANTE: precisa ser o path ordenado, idêntico ao usado na assinatura
  const sortedPath = sortQueryParams(path);
  const stringToSign = buildStringToSign(method, sortedPath, bodyStr);
  // Requests autenticadas incluem access_token na string assinada
  const str = ACCESS_ID + accessToken + t + nonce + stringToSign;
  const sign = hmac256Upper(ACCESS_KEY, str);

  const fetchOpts = {
    method: method.toUpperCase(),
    headers: {
      'client_id': ACCESS_ID,
      'access_token': accessToken,
      'sign': sign,
      'sign_method': 'HMAC-SHA256',
      't': t,
      'nonce': nonce,
      'Content-Type': 'application/json',
    },
  };
  if (body) fetchOpts.body = bodyStr;

  const res = await fetch(ENDPOINT + sortedPath, fetchOpts);
  const data = await res.json();
  if (!data.success) {
    const err = new Error(`Tuya API error (${method} ${path}): ${data.msg || 'unknown'} (code ${data.code})`);
    err.tuyaCode = data.code;
    err.tuyaMsg = data.msg;
    throw err;
  }
  return data.result;
}

module.exports = {
  getAccessToken,
  tuyaRequest,
  ACCESS_ID,
  ENDPOINT,
};
