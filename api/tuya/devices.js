// GET /api/tuya/devices?uid=<smartlife_uid>
// Lista todos os devices vinculados a uma conta SmartLife específica.
// Usado pelo admin do AppTip pra escolher qual sensor cadastrar.

const { tuyaRequest } = require('../_lib/tuya');

module.exports = async function handler(req, res) {
  const uid = req.query && req.query.uid;
  if (!uid) {
    return res.status(400).json({ success: false, error: 'Query param "uid" é obrigatório' });
  }

  try {
    const devices = await tuyaRequest('GET', `/v1.0/users/${uid}/devices`);

    // Filtra + padroniza. Deixa passar qualquer device pro admin ver o que tem,
    // mas marca flag is_temp_sensor pra facilitar filtragem no frontend.
    const simplified = (devices || []).map(d => ({
      id: d.id,
      name: d.name,
      product_name: d.product_name,
      category: d.category,
      online: !!d.online,
      sub: !!d.sub,
      time_zone: d.time_zone,
      ip: d.ip,
      active_time: d.active_time,
      // Sensores T1U e similares têm category "wsdcg" (Temperature & Humidity).
      // Outros de temperatura: "wsdcgq" (com alarm), "wk" (smart plug com temp), etc.
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
