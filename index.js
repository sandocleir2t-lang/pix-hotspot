// ========================================
// API PIX HOTSPOT - Efí Bank + Express
// ========================================

const express = require('express');
const https = require('https');
const fs = require('fs');
const axios = require('axios');
// 1. Validação de variáveis de ambiente
const envsObrigatorias = [
  'EFI_CLIENT_ID',
  'EFI_CLIENT_SECRET',
  'EFI_PIX_KEY',
  'EFI_CERT_PATH'
];

for (const env of envsObrigatorias) {
  if (!process.env[env]) {
    console.error(`❌ ERRO: Variável ${env} não configurada!`);
    process.exit(1);
  }
}

// EFI_CERT_PASSPHRASE pode ser vazia, então não valida
// 2. Configura mTLS com certificado da Efí
let httpsAgent;
try {
  httpsAgent = new https.Agent({
    cert: fs.readFileSync(process.env.EFI_CERT_PATH),
    key: fs.readFileSync(process.env.EFI_CERT_PATH),
    passphrase: process.env.EFI_CERT_PASSPHRASE,
    rejectUnauthorized: false
  });
  console.log('✅ Certificado mTLS carregado com sucesso');
} catch (err) {
  console.error('❌ ERRO ao carregar certificado:', err.message);
  process.exit(1);
}

// 3. Instância Axios configurada pra Efí
const efiApi = axios.create({
  baseURL: 'https://pix.api.efipay.com.br',
  httpsAgent: httpsAgent,
  timeout: 30000
});

// 4. Inicia Express
const app = express();
app.use(express.json()); // ← Habilita req.body

// ========================================
// ROTAS
// ========================================

// Rota de saúde
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    servico: 'API Pix Hotspot',
    versao: '1.0.0'
  });
});

// Rota de teste mTLS
app.get('/teste-efi', async (req, res) => {
  try {
    const auth = Buffer.from(
      `${process.env.EFI_CLIENT_ID}:${process.env.EFI_CLIENT_SECRET}`
    ).toString('base64');

    const response = await efiApi.post('/v1/oauth/token',
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

// Rota principal: Gerar cobrança Pix
app.post('/cobrar', async (req, res) => {
  try {
    const { valor, descricao, devedor } = req.body;

    // Validações
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

    // 1. Gera token OAuth
    console.log('🔐 Gerando token OAuth...');
    const auth = Buffer.from(
      `${process.env.EFI_CLIENT_ID}:${process.env.EFI_CLIENT_SECRET}`
    ).toString('base64');

    const tokenResponse = await efiApi.post('/v1/oauth/token',
      { grant_type: 'client_credentials' },
      { headers: { Authorization: `Basic ${auth}` } }
    );

    const accessToken = tokenResponse.data.access_token;

    // 2. Monta cobrança
    const bodyCob = {
      calendario: { expiracao: 3600 }, // 1 hora
      valor: { original: valorFormatado },
      chave: process.env.EFI_PIX_KEY,
      solicitacaoPagador: descricao || 'Acesso WiFi Hotspot'
    };

    // Adiciona devedor se enviado
    if (devedor?.nome && devedor?.cpf) {
      bodyCob.devedor = {
        nome: devedor.nome,
        cpf: devedor.cpf.replace(/\D/g, '') // Remove pontuação
      };
    }

    // 3. Cria cobrança na Efí
    console.log(`💰 Criando cobrança de R$ ${valorFormatado}...`);
    const cobResponse = await efiApi.post('/v2/cob', bodyCob, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const { txid, pixCopiaECola, loc } = cobResponse.data;

    // 4. Busca QR Code
    console.log('📱 Gerando QR Code...');
    const qrcodeResponse = await efiApi.get(`/v2/loc/${loc.id}/qrcode`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const qrCodeBase64 = qrcodeResponse.data.imagemQrcode;

    // 5. Sucesso
    console.log(`✅ Cobrança criada: ${txid}`);
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
      detalhe: erroEfi?.mensagem || erroEfi?.error_description || err.message
    });
  }
});

// 404 para rotas não encontradas
app.use((req, res) => {
  res.status(404).json({ erro: 'Rota não encontrada' });
});

// ========================================
// INICIA SERVIDOR - SEMPRE POR ÚLTIMO
// ========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`📍 Ambiente: ${process.env.NODE_ENV || 'development'}`);
});
