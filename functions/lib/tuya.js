// Cliente HTTP autenticado pra Tuya Cloud API.
// Cópia da lib /api/_lib/tuya.js usada pelas Vercel Functions, adaptada pra Cloud Functions.
// Lê credenciais de env vars (definidas via `firebase functions:secrets:set`):
//   TUYA_ACCESS_ID
//   TUYA_ACCESS_KEY
//   TUYA_ENDPOINT (ex: https://openapi.tuyaus.com)

const crypto = require('crypto');

function sha256Hex(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

function hmac256Upper(key, str) {
  return crypto.createHmac('sha256', key).update(str, 'utf8').digest('hex').toUpperCase();
}

function sortQueryParams(path) {
  const qIdx = path.indexOf('?');
  if (qIdx < 0) return path;
  const base = path.slice(0, qIdx);
  const query = path.slice(qIdx + 1);
  const params = new URLSearchParams(query);
  const sorted = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const newQuery = sorted.map(([k, v]) => {
    const encoded = encodeURIComponent(v).replace(/%2C/g, ',');
    return `${k}=${encoded}`;
  }).join('&');
  return base + (newQuery ? '?' + newQuery : '');
}

function buildStringToSign(method, urlPathWithQuery, bodyStr = '') {
  const sortedPath = sortQueryParams(urlPathWithQuery);
  const contentHash = sha256Hex(bodyStr);
  return `${method.toUpperCase()}\n${contentHash}\n\n${sortedPath}`;
}

let cachedToken = null;
let cachedTokenExpiresAt = 0;

async function getAccessToken() {
  const ACCESS_ID = process.env.TUYA_ACCESS_ID;
  const ACCESS_KEY = process.env.TUYA_ACCESS_KEY;
  const ENDPOINT = process.env.TUYA_ENDPOINT || 'https://openapi.tuyaus.com';
  if (cachedToken && Date.now() < cachedTokenExpiresAt - 60_000) return cachedToken;
  if (!ACCESS_ID || !ACCESS_KEY) throw new Error('Faltam env vars TUYA_ACCESS_ID e/ou TUYA_ACCESS_KEY');
  const t = Date.now().toString();
  const nonce = crypto.randomUUID();
  const path = '/v1.0/token?grant_type=1';
  const stringToSign = buildStringToSign('GET', path, '');
  const str = ACCESS_ID + t + nonce + stringToSign;
  const sign = hmac256Upper(ACCESS_KEY, str);
  const res = await fetch(ENDPOINT + path, {
    headers: {
      client_id: ACCESS_ID, sign, sign_method: 'HMAC-SHA256', t, nonce,
      'Content-Type': 'application/json',
    },
  });
  const data = await res.json();
  if (!data.success) {
    const err = new Error(`Tuya token error: ${data.msg || 'unknown'} (code ${data.code})`);
    err.tuyaCode = data.code; err.tuyaMsg = data.msg; throw err;
  }
  cachedToken = data.result.access_token;
  cachedTokenExpiresAt = Date.now() + (data.result.expire_time * 1000);
  return cachedToken;
}

async function tuyaRequest(method, path, body = null) {
  const ACCESS_ID = process.env.TUYA_ACCESS_ID;
  const ACCESS_KEY = process.env.TUYA_ACCESS_KEY;
  const ENDPOINT = process.env.TUYA_ENDPOINT || 'https://openapi.tuyaus.com';
  const accessToken = await getAccessToken();
  const t = Date.now().toString();
  const nonce = crypto.randomUUID();
  const bodyStr = body ? JSON.stringify(body) : '';
  const sortedPath = sortQueryParams(path);
  const stringToSign = buildStringToSign(method, sortedPath, bodyStr);
  const str = ACCESS_ID + accessToken + t + nonce + stringToSign;
  const sign = hmac256Upper(ACCESS_KEY, str);
  const fetchOpts = {
    method: method.toUpperCase(),
    headers: {
      client_id: ACCESS_ID, access_token: accessToken, sign,
      sign_method: 'HMAC-SHA256', t, nonce, 'Content-Type': 'application/json',
    },
  };
  if (body) fetchOpts.body = bodyStr;
  const res = await fetch(ENDPOINT + sortedPath, fetchOpts);
  const data = await res.json();
  if (!data.success) {
    const err = new Error(`Tuya API error (${method} ${path}): ${data.msg || 'unknown'} (code ${data.code})`);
    err.tuyaCode = data.code; err.tuyaMsg = data.msg; throw err;
  }
  return data.result;
}

// Pega leitura atual de um device (mesma lógica de /api/tuya/device-status.js)
async function getDeviceStatus(deviceId) {
  const [info, status] = await Promise.all([
    tuyaRequest('GET', `/v1.0/devices/${deviceId}`),
    tuyaRequest('GET', `/v1.0/devices/${deviceId}/status`),
  ]);
  const tempDp = status.find(s => ['va_temperature', 'temp_current', 'temp_current_external'].includes(s.code));
  const humDp  = status.find(s => ['va_humidity', 'humidity_value'].includes(s.code));
  const batDp  = status.find(s => ['battery_percentage', 'battery_state', 'va_battery'].includes(s.code));
  const tempScale = ['wsdcg'].includes(info.category) ? 10 : 1;
  return {
    deviceId,
    online: !!info.online,
    name: info.name,
    category: info.category,
    temp: tempDp ? tempDp.value / tempScale : null,
    humidity: humDp ? humDp.value : null,
    battery: batDp ? batDp.value : null,
    timestamp: new Date().toISOString(),
  };
}

module.exports = { getAccessToken, tuyaRequest, getDeviceStatus };
