// POST /api/ai/generate
// Proxy server-side pro Groq (LLama 3.3) — mantém GROQ_API_KEY fora do bundle público.
//
// Env var necessária (Vercel):
//   GROQ_API_KEY  — chave da API do Groq (sem prefixo REACT_APP_)
//
// Body (JSON):
//   { systemPrompt: string, userInput: string }
//
// Resposta:
//   200 { success: true, data: <objeto JSON parseado da resposta da IA> }
//   4xx/5xx { success: false, error: string }

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = "llama-3.3-70b-versatile";

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ success: false, error: "Somente POST" });
  }

  if (!GROQ_API_KEY || GROQ_API_KEY.length < 20) {
    return res.status(500).json({
      success: false,
      error: "GROQ_API_KEY não configurada no servidor",
    });
  }

  const { systemPrompt, userInput } = req.body || {};
  if (!systemPrompt || !userInput) {
    return res.status(400).json({
      success: false,
      error: "systemPrompt e userInput são obrigatórios",
    });
  }

  let groqRes;
  try {
    groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userInput },
        ],
        temperature: 0.15,
        response_format: { type: "json_object" },
        max_tokens: 4096,
      }),
    });
  } catch (netErr) {
    console.error("[Groq] Erro de rede:", netErr);
    return res.status(502).json({
      success: false,
      error: "Erro de conexão com a IA",
    });
  }

  let groqData;
  try {
    groqData = await groqRes.json();
  } catch (parseErr) {
    console.error("[Groq] Resposta inválida:", groqRes.status);
    return res.status(502).json({
      success: false,
      error: `Resposta inválida da IA (HTTP ${groqRes.status})`,
    });
  }

  if (!groqRes.ok || groqData.error) {
    const msg = groqData.error?.message || `HTTP ${groqRes.status}`;
    console.error("[Groq] Erro da API:", { status: groqRes.status, msg });
    if (groqRes.status === 401) return res.status(500).json({ success: false, error: "Chave da IA inválida no servidor" });
    if (groqRes.status === 429) return res.status(429).json({ success: false, error: "Limite de requisições da IA excedido" });
    if (groqRes.status === 404 || /model.*not.*found|decommission/i.test(msg)) {
      return res.status(500).json({ success: false, error: "Modelo da IA indisponível" });
    }
    return res.status(502).json({ success: false, error: `IA retornou erro: ${msg}` });
  }

  const raw = groqData.choices?.[0]?.message?.content ?? "";
  if (!raw.trim()) {
    return res.status(502).json({ success: false, error: "IA retornou resposta vazia" });
  }

  try {
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
    return res.status(200).json({ success: true, data: parsed });
  } catch (parseErr) {
    console.error("[Groq] Não foi possível parsear JSON:", raw);
    return res.status(502).json({ success: false, error: "IA retornou texto fora do formato esperado" });
  }
};
