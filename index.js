// ========================================
// API PIX HOTSPOT - Efí Bank + Express
// Versão 1.0.2 - Suporte a certificado sem senha
// ========================================

const express = require('express');
const https = require('https');
const fs = require('fs');
const axios = require('axios');

// 1. Validação de variáveis de ambiente - PASSPHRASE É OPCIONAL
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

// 2. Configura mTLS com certificado da Efí - ACEITA SENHA VAZIA
let httpsAgent;
try {
  const certPath = process.env.EFI_CERT_PATH;
  const certBuffer = fs.readFileSync(certPath);
  
  const certOptions = {
    cert: certBuffer,
    key: certBuffer,
    rejectUnauthorized: false
  };

  // Só adiciona passphrase se ela existir e não for string vazia
  if (process.env.EFI_CERT_PASSPHRASE && process.env.EFI_CERT_PASSPHRASE.trim()!== '') {
    certOptions.passphrase = process.env.EFI_CERT_PASSPHRASE;
    console.log('🔐 Usando certificado com senha');
  } else {
    console.log('🔓 Usando certificado sem senha');
  }

  httpsAgent = new https.Agent(certOptions);
  console.log('✅ Certificado mTLS carregado com sucesso');
} catch (err) {
  console.error('❌ ERRO ao carregar certificado:', err.message);
  console.error('Verifique se o arquivo existe em:', process.env.EFI_CERT_PATH);
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
app.use(express.json());

// ========================================
// ROTAS
// ========================================

app.get('/', (req, res) => {
  res.json({
    status: 'online',
    servico: 'API Pix Hotspot',
    versao: '1.0.2',
    ambiente: process.env.NODE_ENV || 'development'
  });
});

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
      token_expira_em: response.data.expires_in,
      certificado: process.env.EFI_CERT_PASSPHRASE? 'com senha' : 'sem senha'
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

    console.log('🔐 Gerando token OAuth...');
    const auth = Buffer.from(
      `${process.env.EFI_CLIENT_ID}:${process.env.EFI_CLIENT_SECRET}`
    ).toString('base64');

    const tokenResponse = await efiApi.post('/v1/oauth/token',
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

    console.log(`💰 Criando cobrança de R$ ${valorFormatado}...`);
    const cobResponse = await efiApi.post('/v2/cob', bodyCob, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const { txid, pixCopiaECola, loc } = cobResponse.data;

    console.log('📱 Gerando QR Code...');
    const qrcodeResponse = await efiApi.get(`/v2/loc/${loc.id}/qrcode`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const qrCodeBase64 = qrcodeResponse.data.imagemQrcode;

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
      detalhe: erroEfi?.mensagem || erroEfi?.error_description || err.message,
      codigo_efi: erroEfi?.nome || erroEfi?.code
    });
  }
});

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
