// GET /api/tuya/app-accounts
// Lista as contas SmartLife que foram vinculadas ao projeto Tuya (via QR code
// no painel Tuya IoT Platform → Devices → Link App Account).
//
// Usado pelo admin do AppTip pra escolher qual conta SmartLife pertence a qual
// restaurante. O UID retornado é gravado em tuyaLinks[restaurantId].uid.

const { tuyaRequest } = require('../_lib/tuya');

module.exports = async function handler(req, res) {
  try {
    // Tuya suporta 2 schemas de app: "smartlife" e "tuyaSmart" (apps brancos).
    // SmartLife é o app padrão. Retornamos contas de ambos pra ser genérico.
    const schemas = ['smartlife', 'tuyaSmart'];
    const allUsers = [];

    for (const schema of schemas) {
      try {
        // Paginação: page_no começa em 1. page_size max 100.
        let pageNo = 1;
        const pageSize = 100;
        while (true) {
          const result = await tuyaRequest(
            'GET',
            `/v1.0/apps/${schema}/users?page_no=${pageNo}&page_size=${pageSize}`
          );
          const users = result.users || result.list || [];
          users.forEach(u => allUsers.push({ ...u, _schema: schema }));
          if (users.length < pageSize) break;
          pageNo++;
          if (pageNo > 10) break; // sanity cap
        }
      } catch (err) {
        // Alguns projetos não têm todos os schemas; ignora 404/empty
        if (err.tuyaCode !== 1108 && err.tuyaCode !== 28841002) {
          throw err;
        }
      }
    }

    res.status(200).json({
      success: true,
      count: allUsers.length,
      users: allUsers.map(u => ({
        uid: u.uid,
        email: u.email || null,
        mobile: u.mobile || null,
        nick_name: u.nick_name || u.nickname || null,
        country_code: u.country_code,
        create_time: u.create_time,
        schema: u._schema,
      })),
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
      tuyaCode: err.tuyaCode,
    });
  }
};
