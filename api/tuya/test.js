// Endpoint de sanity check — confirma que a autenticação Tuya tá funcionando.
// Pega info + status do sensor informado na query (?device=<id>) ou fallback pro T1U conhecido.
//
// Uso local:  vercel dev → http://localhost:3000/api/tuya/test
// Uso prod:   https://apptip.app/api/tuya/test?device=eb068b38a14f4be910tdqb
//
// Saída: JSON com info do device + status bruto + temperatura parseada.
// Não expõe o Access Key; só mostra prefixo/sufixo do Access ID pra debug.

const { tuyaRequest, ACCESS_ID, ENDPOINT } = require('../_lib/tuya');

module.exports = async function handler(req, res) {
  const deviceId = (req.query && req.query.device) || 'eb068b38a14f4be910tdqb';

  const out = {
    success: false,
    env: {
      TUYA_ACCESS_ID: ACCESS_ID ? `${ACCESS_ID.slice(0, 4)}…${ACCESS_ID.slice(-4)}` : '(MISSING)',
      TUYA_ACCESS_KEY: process.env.TUYA_ACCESS_KEY ? '(set)' : '(MISSING)',
      TUYA_ENDPOINT: ENDPOINT,
    },
    deviceId,
  };

  try {
    const info = await tuyaRequest('GET', `/v1.0/devices/${deviceId}`);
    const status = await tuyaRequest('GET', `/v1.0/devices/${deviceId}/status`);

    out.success = true;
    out.device = {
      id: info.id,
      name: info.name,
      product_name: info.product_name,
      category: info.category,
      online: info.online,
      time_zone: info.time_zone,
      ip: info.ip,
      sub: info.sub,
    };
    out.status_raw = status;

    // T1U e sensores similares reportam:
    //   va_temperature ou temp_current → int em 0.1°C (dividir por 10)
    //   va_humidity ou humidity_value  → int %
    //   battery_percentage ou va_battery → int %
    const tempDp = status.find(s =>
      ['va_temperature', 'temp_current', 'temp_current_external'].includes(s.code)
    );
    if (tempDp) {
      out.current_temp_raw = tempDp.value;
      out.current_temp_celsius = tempDp.value / 10;
    }
    const humidityDp = status.find(s =>
      ['va_humidity', 'humidity_value'].includes(s.code)
    );
    if (humidityDp) {
      out.current_humidity_pct = humidityDp.value;
    }
    const batteryDp = status.find(s =>
      ['battery_percentage', 'battery_state', 'va_battery'].includes(s.code)
    );
    if (batteryDp) {
      out.battery = batteryDp.value;
    }

    res.status(200).json(out);
  } catch (err) {
    out.error = err.message;
    out.tuyaCode = err.tuyaCode;
    out.tuyaMsg = err.tuyaMsg;
    res.status(500).json(out);
  }
};
