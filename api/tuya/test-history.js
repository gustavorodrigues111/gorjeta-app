// GET /api/tuya/test-history?device=<id>&hours=72
// Endpoint de DEBUG: chama o Tuya e devolve a resposta crua, sem normalização.
// Use pra diagnosticar por que o backfill não está retornando leituras.
//
// Exemplos no navegador (cole na URL):
//   /api/tuya/test-history?device=bf3aa0e2...
//   /api/tuya/test-history?device=bf3aa0e2...&hours=24
//
// Retorna:
// - device info (name, category, online)
// - status atual (codes que o sensor reporta agora)
// - logs históricos (raw resposta do report-logs)

const { tuyaRequest } = require('../_lib/tuya');

module.exports = async function handler(req, res) {
  const deviceId = req.query && req.query.device;
  if (!deviceId) {
    return res.status(400).json({ error: 'Query param "device" é obrigatório' });
  }
  const hoursBack = parseInt(req.query.hours || '72', 10);
  const now = Date.now();
  const fromMs = now - hoursBack * 60 * 60 * 1000;

  // Lista TODOS os codes que aparecem no status do device — pra detectar o nome certo do sensor
  let info = null, status = null, statusCodes = [];
  try {
    info = await tuyaRequest('GET', `/v1.0/devices/${deviceId}`);
    status = await tuyaRequest('GET', `/v1.0/devices/${deviceId}/status`);
    statusCodes = (status || []).map(s => ({ code: s.code, value: s.value, type: typeof s.value }));
  } catch (e) {
    return res.status(500).json({ stage: 'info/status', error: e.message, tuyaCode: e.tuyaCode });
  }

  // Tenta buscar logs com várias listas de codes — tenta achar o que retorna dado
  const codeAttempts = [
    'temp_current,va_temperature,temp_current_external,va_humidity,humidity_value,battery_percentage,va_battery',
    'temp_current',
    'va_temperature',
    statusCodes.map(c => c.code).join(','), // todos os codes que o sensor realmente reporta
  ];

  const results = [];
  for (const codes of codeAttempts) {
    if (!codes) continue;
    try {
      const params = new URLSearchParams({
        codes,
        start_time: String(fromMs),
        end_time: String(now),
        size: '100',
      });
      const path = `/v2.0/cloud/thing/${deviceId}/report-logs?${params.toString()}`;
      const data = await tuyaRequest('GET', path);
      results.push({
        codes_query: codes,
        total_logs: (data.logs || []).length,
        has_next: data.has_next,
        first_3_logs: (data.logs || []).slice(0, 3),
        unique_codes_in_response: [...new Set((data.logs || []).map(l => l.code))],
      });
    } catch (e) {
      results.push({
        codes_query: codes,
        error: e.message,
        tuyaCode: e.tuyaCode,
      });
    }
  }

  res.status(200).json({
    deviceId,
    hoursBack,
    fromMs,
    now,
    info: {
      name: info.name,
      category: info.category,
      product_name: info.product_name,
      online: info.online,
      active_time: info.active_time,
    },
    statusCodes,
    historyAttempts: results,
  });
};
