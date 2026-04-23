# AppTip — Backend Serverless (Vercel Functions)

Funções serverless pra integrar com APIs externas (Tuya Cloud / SmartLife).

## Estrutura

```
api/
  _lib/
    tuya.js       # Cliente HTTP autenticado pra Tuya (assinatura HMAC-SHA256)
  tuya/
    test.js       # [sanity] GET /api/tuya/test?device=<id> → info + status
```

Arquivos em `_lib/` têm prefixo `_` pra Vercel não tratar como endpoints públicos.

## Env Vars (Vercel → Project Settings → Environment Variables)

| Nome | Descrição | Onde obter |
|---|---|---|
| `TUYA_ACCESS_ID`  | Access ID do projeto Tuya | iot.tuya.com → Cloud → projeto → Overview → Authorization |
| `TUYA_ACCESS_KEY` | Access Secret do projeto Tuya | idem (clica no olhinho pra revelar e copiar) |
| `TUYA_ENDPOINT`   | URL do data center | `https://openapi.tuyaus.com` (Western America) |

⚠️ `TUYA_ACCESS_KEY` nunca deve ir pro código-fonte, chat, log ou response.

## Testar

Depois de fazer deploy (git push → Vercel builda automático):

```
https://apptip.app/api/tuya/test
https://apptip.app/api/tuya/test?device=eb068b38a14f4be910tdqb
```

Sem query param, usa o Device ID do T1U cadastrado (Geladeira de Casa - Teste).

Resposta esperada (sucesso):
```json
{
  "success": true,
  "env": { "TUYA_ACCESS_ID": "dy45…fkg8", "TUYA_ACCESS_KEY": "(set)", "TUYA_ENDPOINT": "https://openapi.tuyaus.com" },
  "deviceId": "eb068b38a14f4be910tdqb",
  "device": { "id": "…", "name": "Geladeira de Casa - Teste", "online": true, … },
  "status_raw": [ … ],
  "current_temp_celsius": 4.2,
  "current_humidity_pct": 45,
  "battery": 88
}
```

Se der erro, o JSON volta com `success: false` + `error` + `tuyaCode`. Os códigos de erro mais comuns:
- `1004` = sign invalid → assinatura HMAC errada (bug no código)
- `1106` = permission denied → conta não autorizada / device não acessível
- `2001` = parameter error → path ou body errados
