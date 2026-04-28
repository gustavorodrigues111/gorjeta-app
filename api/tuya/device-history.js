// GET /api/tuya/device-history?device=<id>&from=<ms>&to=<ms>&codes=temp_current,va_temperature
// Retorna leituras HISTÓRICAS de um device Tuya entre dois timestamps.
// Tuya mantém o histórico no servidor independente de conexão do cliente — esse endpoint
// permite "preencher buracos" na coleção tempReadings sem precisar de cron 24/7.
//
// Tuya endpoint: /v2.0/cloud/thing/{device_id}/report-logs
//   - codes: lista CSV dos data points (ex: "temp_current,va_temperature,va_humidity")
//   - start_time / end_time: timestamps ms
//   - size: 100 max
//
// Resposta:
// {
//   success: true,
//   deviceId,
//   readings: [{ timestamp, code, value, valueRaw }, ...],
//   hasMore: bool,
//   lastRowKey: string | null,
// }

const { tuyaRequest } = require('../_lib/tuya');

// Códigos Tuya usados pelos sensores wsdcg/T1U
const DEFAULT_CODES = ['temp_current', 'va_temperature', 'temp_current_external', 'va_humidity', 'humidity_value', 'battery_percentage', 'va_battery'];

module.exports = async function handler(req, res) {
  const deviceId = req.query && req.query.device;
  if (!deviceId) {
    return res.status(400).json({ success: false, error: 'Query param "device" é obrigatório' });
  }

  // Janela de tempo: default últimas 7 dias
  const now = Date.now();
  const defaultFrom = now - 7 * 24 * 60 * 60 * 1000;
  const fromMs = parseInt(req.query.from || defaultFrom, 10);
  const toMs   = parseInt(req.query.to   || now, 10);

  if (isNaN(fromMs) || isNaN(toMs) || fromMs >= toMs) {
    return res.status(400).json({ success: false, error: 'Parâmetros from/to inválidos' });
  }
  // Tuya limita a 7 dias por request
  const MAX_RANGE_MS = 7 * 24 * 60 * 60 * 1000;
  if (toMs - fromMs > MAX_RANGE_MS) {
    return res.status(400).json({ success: false, error: 'Janela máxima é de 7 dias por request. Faça múltiplas chamadas pra períodos maiores.' });
  }

  const codesQuery = (req.query.codes || DEFAULT_CODES.join(',')).trim();
  const sizeQuery = Math.min(parseInt(req.query.size || '100', 10) || 100, 100);
  const lastRowKey = req.query.lastRowKey || null;

  try {
    // Pega categoria do device pra normalizar escala (sensores wsdcg reportam temp em 0.1°C)
    const info = await tuyaRequest('GET', `/v1.0/devices/${deviceId}`);
    const category = info.category;
    const tempScale = ['wsdcg'].includes(category) ? 10 : 1;

    // Monta a query do report-logs
    const params = new URLSearchParams({
      codes: codesQuery,
      start_time: String(fromMs),
      end_time: String(toMs),
      size: String(sizeQuery),
    });
    if (lastRowKey) params.set('last_row_key', lastRowKey);
    const path = `/v2.0/cloud/thing/${deviceId}/report-logs?${params.toString()}`;

    const data = await tuyaRequest('GET', path);

    // Normaliza leituras: cada log tem { code, value (string), event_time (ms) }
    const tempCodes = new Set(['temp_current', 'va_temperature', 'temp_current_external']);
    const humCodes = new Set(['va_humidity', 'humidity_value']);
    const batCodes = new Set(['battery_percentage', 'battery_state', 'va_battery']);

    const readings = (data.logs || []).map(log => {
      const valNum = parseFloat(log.value);
      const isTemp = tempCodes.has(log.code);
      const isHum = humCodes.has(log.code);
      const isBat = batCodes.has(log.code);
      return {
        timestamp: new Date(parseInt(log.event_time, 10)).toISOString(),
        timestampMs: parseInt(log.event_time, 10),
        code: log.code,
        valueRaw: log.value,
        // Normalização: temp dividida pela escala apropriada
        temp: isTemp && !isNaN(valNum) ? valNum / tempScale : null,
        humidity: isHum && !isNaN(valNum) ? valNum : null,
        battery: isBat && !isNaN(valNum) ? valNum : null,
      };
    });

    res.status(200).json({
      success: true,
      deviceId,
      category,
      from: fromMs,
      to: toMs,
      readings,
      total: readings.length,
      hasMore: !!data.has_next,
      lastRowKey: data.last_row_key || null,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      deviceId,
      error: err.message,
      tuyaCode: err.tuyaCode,
    });
  }
};
