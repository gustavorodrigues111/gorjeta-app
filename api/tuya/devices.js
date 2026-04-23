// GET /api/tuya/devices?uid=<smartlife_uid>
// Lista devices de uma conta SmartLife específica.
// Usa /v1.0/iot-01/associated-users/devices (IoT Core) e filtra por uid client-side.

const { tuyaRequest } = require('../_lib/tuya');

module.exports = async function handler(req, res) {
  const uid = req.query && req.query.uid;
  if (!uid) {
    return res.status(400).json({ success: false, error: 'Query param "uid" é obrigatório' });
  }

  try {
    const allDevices = [];
    let lastRowKey = '';
    for (let i = 0; i < 20; i++) {
      const qs = `page_size=100${lastRowKey ? `&last_row_key=${encodeURIComponent(lastRowKey)}` : ''}`;
      const result = await tuyaRequest('GET', `/v1.0/iot-01/associated-users/devices?${qs}`);
      const devs = result.devices || result.list || [];
      allDevices.push(...devs);
      if (!result.has_more || !result.last_row_key) break;
      lastRowKey = result.last_row_key;
    }

    const ofUser = allDevices.filter(d => d.uid === uid);
    const simplified = ofUser.map(d => ({
      id: d.id,
      name: d.name,
      product_name: d.product_name,
      category: d.category,
      online: !!d.online,
      sub: !!d.sub,
      time_zone: d.time_zone,
      active_time: d.active_time,
      is_temp_sensor: ['wsdcg', 'wsdcgq', 'wts'].includes(d.category),
    }));

    res.status(200).json({
      success: true,
      uid,
      count: simplified.length,
      devices: simplified,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      uid,
      error: err.message,
      tuyaCode: err.tuyaCode,
    });
  }
};
