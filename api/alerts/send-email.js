// POST /api/alerts/send-email
// Dispara email transacional via Resend (resend.com)
//
// Env vars necessárias (Vercel):
//   RESEND_API_KEY   — chave da API do Resend (Dashboard → API Keys)
//   ALERT_FROM       — email remetente. Default: alertas@apptip.app
//                      O domínio precisa estar verificado no Resend primeiro.
//
// Body (JSON):
//   { to: string|string[], subject: string, html: string, replyTo?: string }

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const ALERT_FROM     = process.env.ALERT_FROM || 'alertas@apptip.app';
const ALERT_FROM_NAME = process.env.ALERT_FROM_NAME || 'AppTip Alertas';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Somente POST' });
  }

  if (!RESEND_API_KEY) {
    return res.status(500).json({
      success: false,
      error: 'RESEND_API_KEY não configurada nas env vars da Vercel',
    });
  }

  const { to, subject, html, replyTo } = req.body || {};
  if (!to || !subject || !html) {
    return res.status(400).json({
      success: false,
      error: 'Campos obrigatórios: to, subject, html',
    });
  }

  const recipients = Array.isArray(to) ? to : [to];

  try {
    const payload = {
      from: `${ALERT_FROM_NAME} <${ALERT_FROM}>`,
      to: recipients,
      subject,
      html,
    };
    if (replyTo) payload.reply_to = replyTo;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: data.message || data.name || 'Erro no Resend',
        resendStatus: response.status,
      });
    }

    res.status(200).json({
      success: true,
      id: data.id,
      recipients,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
};
