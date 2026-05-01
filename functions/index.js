// AppTip — Firebase Scheduled Functions
// Cron poll de sensores Tuya — roda a cada 30 min independente da tela estar aberta.
// Lê /appdata/v4:tempSensors do Firestore, busca leitura atual de cada sensor ativo,
// agrega em /appdata/v4:tempReadings (mesmo schema do client) e compacta antigas.

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const { getDeviceStatus } = require('./lib/tuya');

admin.initializeApp();
const db = admin.firestore();

// Mesmas constantes/política do compactTempReadings client (App.js linha ~30856)
const TEMP_RETENTION_MS = 6 * 30 * 24 * 60 * 60 * 1000; // 6 meses
const TEMP_HIRES_WINDOW_MS = 24 * 60 * 60 * 1000;       // 24h alta-res
const TEMP_ANCHOR_HOURS = [0, 6, 12, 18];

// Compacta array de leituras (1 por hora nas últimas 24h, 4 por dia depois)
function compactTempReadings(readings) {
  if (!readings || readings.length === 0) return [];
  const now = Date.now();
  const cutoffOld = now - TEMP_RETENTION_MS;
  const cutoffHires = now - TEMP_HIRES_WINDOW_MS;
  const buckets = new Map();
  for (const r of readings) {
    const ts = new Date(r.timestamp).getTime();
    if (isNaN(ts) || ts < cutoffOld) continue;
    let bucketKey;
    if (ts >= cutoffHires) {
      bucketKey = `${r.sensorId}|H|${Math.floor(ts / (60 * 60 * 1000))}`;
    } else {
      const d = new Date(ts);
      const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const hour = d.getHours();
      const anchor = TEMP_ANCHOR_HOURS.reduce((best, a) =>
        Math.abs(hour - a) < Math.abs(hour - best) ? a : best, TEMP_ANCHOR_HOURS[0]);
      bucketKey = `${r.sensorId}|A|${dayKey}|${anchor}`;
    }
    const existing = buckets.get(bucketKey);
    if (!existing) {
      buckets.set(bucketKey, r);
    } else if (ts < cutoffHires) {
      const d = new Date(ts);
      const hour = d.getHours();
      const anchor = parseInt(bucketKey.split('|').pop(), 10);
      const dExisting = new Date(existing.timestamp);
      const distNew = Math.abs(hour - anchor) * 60 + Math.abs(d.getMinutes());
      const distOld = Math.abs(dExisting.getHours() - anchor) * 60 + Math.abs(dExisting.getMinutes());
      if (distNew < distOld) buckets.set(bucketKey, r);
    }
  }
  return [...buckets.values()].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

// Função principal — agendada via Cloud Scheduler.
// `0,30 * * * *` = a cada 30 min, no minuto 0 e 30 (UTC).
exports.tuyaPoll = onSchedule(
  {
    schedule: 'every 30 minutes',
    timeZone: 'America/Sao_Paulo',
    region: 'southamerica-east1',
    secrets: ['TUYA_ACCESS_ID', 'TUYA_ACCESS_KEY', 'TUYA_ENDPOINT'],
    memory: '256MiB',
    timeoutSeconds: 120,
  },
  async () => {
    const startedAt = Date.now();
    logger.info('🌡️ tuyaPoll iniciado');

    // 1. Lê tempSensors do Firestore
    const sensorsDoc = await db.doc('appdata/v4:tempSensors').get();
    const allSensors = (sensorsDoc.data()?.value) || [];
    const activeSensors = allSensors.filter(s => s.active !== false && s.tuyaDeviceId);
    logger.info(`📡 ${activeSensors.length} sensores ativos (de ${allSensors.length} totais)`);
    if (activeSensors.length === 0) return;

    // 2. Busca leitura de cada sensor em paralelo (com tolerância a erro individual)
    const newReadings = [];
    const errors = [];
    await Promise.all(activeSensors.map(async (s) => {
      try {
        const data = await getDeviceStatus(s.tuyaDeviceId);
        newReadings.push({
          id: `rd_cron_${Date.now().toString(36)}_${s.id.slice(-4)}_${Math.random().toString(36).slice(2, 5)}`,
          sensorId: s.id,
          restaurantId: s.restaurantId,
          timestamp: data.timestamp,
          temp: data.temp,
          humidity: data.humidity,
          battery: data.battery,
          online: data.online,
        });
      } catch (e) {
        errors.push(`${s.name || s.id}: ${e.message}`);
        logger.warn(`Falha em ${s.name || s.id}: ${e.message}`);
      }
    }));

    if (newReadings.length === 0) {
      logger.warn('Nenhuma leitura obtida', { errors });
      return;
    }

    // 3. Lê tempReadings existentes, junta + compacta + escreve
    const readingsDoc = await db.doc('appdata/v4:tempReadings').get();
    const existing = (readingsDoc.data()?.value) || [];
    const merged = compactTempReadings([...existing, ...newReadings]);
    await db.doc('appdata/v4:tempReadings').set({ value: merged });

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    logger.info(`✅ ${newReadings.length} leituras gravadas; total compactado: ${merged.length}; ${elapsed}s; erros: ${errors.length}`);
  }
);
