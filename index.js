const express = require('express');
const cors = require('cors');
const fs = require('fs');
const EfiPay = require('sdk-node-apis-efi');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Lê o certificado base64 e converte pra Buffer
const certificado = Buffer.from(
  fs.readFileSync(process.env.EFI_CERT_PATH, 'utf8'), 
  'base64'
);

const options = {
  sandbox: false, // MUDE PRA false se seu cert é de PRODUÇÃO
  client_id: process.env.EFI_CLIENT_ID,
  client_secret: process.env.EFI_CLIENT_SECRET,
  certificate: certificado, // TEM QUE SER O BUFFER, não o caminho
  cert_base64: false
};

const efipay = new EfiPay(options);

app.post('/criar-cobranca', async (req, res) => {
  try {
    const { valor, nome, cpf } = req.body;
    
    const body = {
      calendario: { expiracao: 3600 },
      devedor: { cpf, nome },
      valor: { original: valor.toFixed(2) },
      chave: process.env.EFI_PIX_KEY,
      solicitacaoPagador: "Acesso Hotspot WiFi"
    };

    const response = await efipay.pixCreateImmediateCharge([], body);
    res.status(200).json(response);
    
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log('Servidor rodando na porta', PORT);
});
