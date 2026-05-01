# AppTip — Cloud Functions

Funções agendadas que rodam no Firebase, **independente da tela do app estar aberta**.

## Funções

### `tuyaPoll` — leitura periódica de sensores

- **Cron**: a cada 30 minutos (TZ America/Sao_Paulo)
- **Faz**: itera `tempSensors` ativos no Firestore, chama Tuya API pra cada um, grava em `tempReadings` (com compactação automática — 1/h nas últimas 24h, 4/dia depois)
- **Resultado**: relatório de temperaturas sempre completo, sem "buracos" causados por ninguém abrir a tela

## Setup inicial (1ª vez)

### 1. Mudar pro plano Blaze

Cloud Functions exigem o plano **Blaze (pay-as-you-go)**. Pra essa carga (2-10 sensores × 48 invocações/dia) o custo real fica próximo de zero — bem dentro do free tier do Blaze (2M invocações/mês grátis).

Pelo console: https://console.firebase.google.com/project/gorjeta-app/usage/details → "Modify plan" → Blaze. Vai pedir cartão.

### 2. Instalar Firebase CLI (se ainda não tem)

```bash
npm install -g firebase-tools
firebase login
```

### 3. Configurar secrets do Tuya

Os mesmos `TUYA_ACCESS_ID` / `TUYA_ACCESS_KEY` / `TUYA_ENDPOINT` que estão no Vercel:

```bash
cd ~/Downloads/gorjeta-app/gorjeta-app
firebase functions:secrets:set TUYA_ACCESS_ID
# (cola o valor quando pedir, sem aspas)
firebase functions:secrets:set TUYA_ACCESS_KEY
firebase functions:secrets:set TUYA_ENDPOINT
# valor do endpoint: https://openapi.tuyaus.com   (ou o que tá no Vercel — ver .env.local)
```

### 4. Instalar deps + deploy

```bash
cd functions
npm install
cd ..
firebase deploy --only functions
```

O deploy demora 2-5 min na primeira vez. Cria a função e o agendamento no Cloud Scheduler automaticamente.

### 5. Verificar

Logs ao vivo:
```bash
firebase functions:log --only tuyaPoll
```

Console: https://console.firebase.google.com/project/gorjeta-app/functions

A primeira execução acontece dentro de 30 minutos. Pra forçar imediatamente, no console: Functions → tuyaPoll → "Test" → Run now.

## Custos esperados

Pra cenário típico (5 sensores × 48 polls/dia = 240 invocações/dia ≈ 7.200/mês):
- Cloud Functions: dentro do free tier (2M invocações/mês)
- Cloud Scheduler: 3 jobs grátis (estamos usando 1)
- Firestore reads/writes: ~14k reads + 7.2k writes/mês — bem dentro do free tier
- **Tuya API**: ilimitado pra projetos pessoais/cloud, não cobra
- **Total esperado**: R$ 0,00/mês

## Manutenção

Pra desativar temporariamente sem deletar:
```bash
gcloud scheduler jobs pause firebase-schedule-tuyaPoll-southamerica-east1 --location=southamerica-east1
```

Pra reativar:
```bash
gcloud scheduler jobs resume firebase-schedule-tuyaPoll-southamerica-east1 --location=southamerica-east1
```
