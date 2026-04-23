// GET /api/tuya/device-status?device=<id>
// Retorna leitura atual (temp, humidade, bateria, online) de um device Tuya.
// Chamado pelo cliente a cada N minutos pra atualizar tempReadings.

const { tuyaRequest } = require('../_lib/tuya');

module.exports = async function handler(req, res) {
  const deviceId = req.query && req.query.device;
  if (!deviceId) {
    return res.status(400).json({ success: false, error: 'Query param "device" é obrigatório' });
  }

  try {
    const [info, status] = await Promise.all([
      tuyaRequest('GET', `/v1.0/devices/${deviceId}`),
      tuyaRequest('GET', `/v1.0/devices/${deviceId}/status`),
    ]);

    const tempDp = status.find(s =>
      ['va_temperature', 'temp_current', 'temp_current_external'].includes(s.code)
    );
    const humDp = status.find(s =>
      ['va_humidity', 'humidity_value'].includes(s.code)
    );
    const batDp = status.find(s =>
      ['battery_percentage', 'battery_state', 'va_battery'].includes(s.code)
    );

    // Sensores de temp/umidade Tuya (categoria 'wsdcg' = T1U e similares) reportam
    // temp sempre em 0.1°C — divide por 10. Outros modelos podem usar escala diferente
    // e vamos precisar buscar a spec do produto (/v1.0/devices/{id}/specifications)
    // quando aparecerem. Pro piloto com T1U basta /10.
    const category = info.category;
    const tempScale = ['wsdcg'].includes(category) ? 10 : 1;

    res.status(200).json({
      success: true,
      deviceId,
      online: !!info.online,
      name: info.name,
      product_name: info.product_name,
      category,
      temp: tempDp ? tempDp.value / tempScale : null,
      temp_raw: tempDp ? tempDp.value : null,
      humidity: humDp ? humDp.value : null,
      battery: batDp ? batDp.value : null,
      timestamp: new Date().toISOString(),
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
