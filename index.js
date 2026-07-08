const EfiPay = require('sdk-node-apis-efi')
const fs = require('fs')
const express = require('express')
const app = express()
app.use(express.json())

// CORREÇÃO: Lê o arquivo .b64 e converte pra buffer .p12
const certBase64 = fs.readFileSync(process.env.EFI_CERT_PATH, 'utf8')
const certificado = Buffer.from(certBase64, 'base64')

const options = {
  sandbox: false, // ← IMPORTANTE: false pra produção
  client_id: process.env.EFI_CLIENT_ID,
  client_secret: process.env.EFI_CLIENT_SECRET,
  certificate: certificado, // ← TEM QUE SER O BUFFER .p12
  cert_base64: false
}

const efipay = new EfiPay(options)

app.post('/criar-cobranca', async (req, res) => {
  try {
    const { valor, nome, cpf } = req.body
    
    const body = {
      calendario: { expiracao: 3600 },
      devedor: { cpf: cpf, nome: nome },
      valor: { original: valor.toFixed(2) },
      chave: process.env.EFI_PIX_KEY,
      solicitacaoPagador: 'Pagamento Hotspot'
    }
    
    const response = await efipay.pixCreateImmediateCharge([], body)
    
    const params = { id: response.loc.id }
    const qrcode = await efipay.pixGenerateQRCode(params)
    
    res.json({
      txid: response.txid,
      pixCopiaECola: qrcode.qrcode,
      qrcode: qrcode.imagemQrcode
    })
    
  } catch (error) {
    console.error('Erro Efí:', error)
    res.status(500).json({ error: error.message })
  }
})

const PORT = process.env.PORT || 10000
app.listen(PORT, () => {
  console.log('Servidor rodando na porta ' + PORT)
})
