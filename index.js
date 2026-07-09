require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { EfiPay } = require('sdk-node-apis-efi');

const app = express();
app.use(cors());
app.use(express.json());

// Verifica variáveis obrigatórias
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

// Configura Efí com certificado em base64
const efipay = new EfiPay({
  client_id: process.env.EFI_CLIENT_ID,
  client_secret: process.env.EFI_CLIENT_SECRET,
  certificate: Buffer.from(process.env.EFI_CERT_P12, 'base64'),
  password: process.env.EFI_CERT_PASSWORD || '',
  sandbox: false
});

console.log('✅ Efí configurada com sucesso');

// Rota pra criar cobrança Pix
app.post('/criar-cobranca', async (req, res) => {
  try {
    const { valor } = req.body;

    if (!valor) {
      return res.status(400).json({ erro: 'Valor é obrigatório' });
    }

    const body = {
      calendario: { expiracao: 3600 },
      valor: { original: valor.toFixed(2) },
      chave: process.env.EFI_PIX_KEY,
      solicitacaoPagador: 'Pagamento Hotspot'
    };

    const cobranca = await efipay.pixCreateImmediateCharge([], body);
    const qrcode = await efipay.pixGenerateQRCode({ id: cobranca.loc.id });

    res.json({
      txid: cobranca.txid,
      qrcode: qrcode.qrcode,
      imagemQrcode: qrcode.imagemQrcode,
      copiaECola: qrcode.qrcode
    });

  } catch (error) {
    console.error('Erro ao criar cobrança:', error);
    res.status(500).json({ erro: error.message });
  }
});

// Rota de teste
app.get('/', (req, res) => {
  res.json({ status: 'API Pix Online' });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`📍 Ambiente: ${process.env.NODE_ENV || 'development'}`);
});
