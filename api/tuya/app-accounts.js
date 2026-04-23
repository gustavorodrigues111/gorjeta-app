// GET /api/tuya/app-accounts
// Lista as contas SmartLife que têm devices vinculados ao projeto Tuya.
// Em vez de usar /v1.0/apps/{schema}/users (que requer service "User Service"
// que nem todos os planos têm), a gente pega a lista de devices do projeto
// e agrupa por uid — o resultado é a lista de donos de pelo menos 1 device.

const { tuyaRequest } = require('../_lib/tuya');

module.exports = async function handler(req, res) {
  try {
    // /v1.0/iot-01/associated-users/devices lista todos devices do projeto
    // com o campo `uid` (dono SmartLife).
    // Paginação: cursor-based via last_row_key.
    const allDevices = [];
    let lastRowKey = '';
    for (let i = 0; i < 20; i++) { // sanity cap 20 pages (2000 devices)
      const qs = `page_size=100${lastRowKey ? `&last_row_key=${encodeURIComponent(lastRowKey)}` : ''}`;
      const result = await tuyaRequest('GET', `/v1.0/iot-01/associated-users/devices?${qs}`);
      const devs = result.devices || result.list || [];
      allDevices.push(...devs);
      if (!result.has_more || !result.last_row_key) break;
      lastRowKey = result.last_row_key;
    }

    // Agrupa por uid. Cada uid vira um registro de "conta".
    const byUid = {};
    allDevices.forEach(d => {
      const uid = d.uid;
      if (!uid) return;
      if (!byUid[uid]) {
        byUid[uid] = {
          uid,
          device_count: 0,
          sample_device_name: d.name || null,
          first_seen: d.active_time || null,
        };
      }
      byUid[uid].device_count += 1;
      if (d.active_time && (!byUid[uid].first_seen || d.active_time < byUid[uid].first_seen)) {
        byUid[uid].first_seen = d.active_time;
      }
    });

    const users = Object.values(byUid).sort((a, b) => b.device_count - a.device_count);

    res.status(200).json({
      success: true,
      count: users.length,
      users,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
      tuyaCode: err.tuyaCode,
    });
  }
};
