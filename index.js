// ========================================
// API PIX HOTSPOT - Efí Bank + Express
// Versão 1.0.4 - URL OAuth corrigida
// ========================================
const cors = require('cors');
const express = require('express');
const https = require('https');
const fs = require('fs');
const axios = require('axios');

const envsObrigatorias = [
  'EFI_CLIENT_ID',
  'EFI_CLIENT_SECRET',
  'EFI_PIX_KEY',
  'EFI_CERT_P12'
];

for (const env of envsObrigatorias) {
  if (!process.env[env]) {
    console.error(`❌ ERRO: Variável ${env} não configurada!`);
    process.exit(1);
  }
}

let httpsAgent;
try {
  const certPath = process.env.EFI_CERT_PATH;
  const certBuffer = fs.readFileSync(certPath);
  
  httpsAgent = new https.Agent({
    cert: certBuffer,
    key: certBuffer,
    rejectUnauthorized: false
  });
  console.log('✅ Certificado mTLS.pem carregado com sucesso');
} catch (err) {
  console.error('❌ ERRO ao carregar certificado:', err.message);
  process.exit(1);
}

const efiApi = axios.create({
  baseURL: 'https://pix.api.efipay.com.br',
  httpsAgent: httpsAgent,
  timeout: 30000
});
const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({
    status: 'online',
    servico: 'API Pix Hotspot',
    versao: '1.0.4',
    ambiente: process.env.NODE_ENV || 'development'
  });
});

app.get('/teste-efi', async (req, res) => {
  try {
    const auth = Buffer.from(
      `${process.env.EFI_CLIENT_ID}:${process.env.EFI_CLIENT_SECRET}`
    ).toString('base64');

    // CORREÇÃO: URL é /oauth/token sem /v1
    const response = await efiApi.post('/oauth/token',
      { grant_type: 'client_credentials' },
      { headers: { Authorization: `Basic ${auth}` } }
    );

    res.json({
      status: 'MTLS FUNCIONOU!',
      token_expira_em: response.data.expires_in
    });
  } catch (err) {
    console.error('ERRO /teste-efi:', err.response?.data || err.message);
    res.status(500).json({
      erro: 'Falha no teste mTLS',
      detalhe: err.response?.data || err.message
    });
  }
});

app.post('/cobrar', async (req, res) => {
  try {
    const { valor, descricao, devedor } = req.body;

    if (!valor) {
      return res.status(400).json({
        erro: 'Campo obrigatório faltando',
        detalhe: 'Envie: {"valor": "5.00"}'
      });
    }

    const valorFormatado = parseFloat(valor).toFixed(2);
    if (isNaN(valorFormatado) || valorFormatado <= 0) {
      return res.status(400).json({
        erro: 'Valor inválido',
        detalhe: 'Use formato: "5.00"'
      });
    }

    const auth = Buffer.from(
      `${process.env.EFI_CLIENT_ID}:${process.env.EFI_CLIENT_SECRET}`
    ).toString('base64');

    // CORREÇÃO: URL é /oauth/token sem /v1
    const tokenResponse = await efiApi.post('/oauth/token',
      { grant_type: 'client_credentials' },
      { headers: { Authorization: `Basic ${auth}` } }
    );

    const accessToken = tokenResponse.data.access_token;

    const bodyCob = {
      calendario: { expiracao: 3600 },
      valor: { original: valorFormatado },
      chave: process.env.EFI_PIX_KEY,
      solicitacaoPagador: descricao || 'Acesso WiFi Hotspot'
    };

    if (devedor?.nome && devedor?.cpf) {
      bodyCob.devedor = {
        nome: devedor.nome,
        cpf: devedor.cpf.replace(/\D/g, '')
      };
    }

    const cobResponse = await efiApi.post('/v2/cob', bodyCob, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const { txid, pixCopiaECola, loc } = cobResponse.data;

    const qrcodeResponse = await efiApi.get(`/v2/loc/${loc.id}/qrcode`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const qrCodeBase64 = qrcodeResponse.data.imagemQrcode;

    res.json({
      status: 'Cobranca criada com sucesso',
      txid: txid,
      valor: valorFormatado,
      expiraEm: '3600 segundos',
      pixCopiaECola: pixCopiaECola,
      qrCode: `data:image/png;base64,${qrCodeBase64}`
    });

  } catch (err) {
    const erroEfi = err.response?.data;
    console.error('❌ ERRO NA ROTA /cobrar:', erroEfi || err.message);

    res.status(500).json({
      erro: 'Falha ao gerar cobrança Pix',
      detalhe: erroEfi?.mensagem || erroEfi?.error_description || err.message,
      codigo_efi: erroEfi?.nome || erroEfi?.code
    });
  }
});

app.use((req, res) => {
  res.status(404).json({ erro: 'Rota não encontrada' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`📍 Ambiente: ${process.env.NODE_ENV || 'development'}`);
});
