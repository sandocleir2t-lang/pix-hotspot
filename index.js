const express = require('express');
const cors = require('cors');
const fs = require('fs');
const https = require('https');
const EfiPay = require('sdk-node-apis-efi');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const EFI_CONFIG = {
  clientId: process.env.EFI_CLIENT_ID,
  clientSecret: process.env.EFI_CLIENT_SECRET,
  certPath: process.env.EFI_CERT_PATH,
  pixKey: process.env.EFI_PIX_KEY,
  sandbox: false
};

let httpsAgent;
try {
  const certBase64 = fs.readFileSync(EFI_CONFIG.certPath, 'utf8');
  const certBuffer = Buffer.from(certBase64, 'base64');
  
  httpsAgent = new https.Agent({
    pfx: certBuffer,
    passphrase: '' 
  });
  console.log('Certificado mTLS carregado de base64');
} catch (err) {
  console.error('Erro ao carregar certificado:', err.message);
}

const efipay = new EfiPay({
  client_id: EFI_CONFIG.clientId,
  client_secret: EFI_CONFIG.clientSecret,
  certificate: httpsAgent,
  sandbox: EFI_CONFIG.sandbox
});

app.post('/criar-cobranca', async (req, res) => {
  try {
    const { valor, nome, cpf } = req.body;
    
    const body = {
      calendario: { expiracao: 3600 },
      devedor: { cpf, nome },
      valor: { original: valor.toFixed(2) },
      chave: EFI_CONFIG.pixKey,
      solicitacaoPagador: 'Pagamento hotspot'
    };

    const cobranca = await efipay.pixCreateImmediateCharge([], body);
    res.json(cobranca);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
