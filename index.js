const express = require('express')
const cors = require('cors')
const fs = require('fs')
const EfiPay = require('sdk-node-apis-efi')

const app = express()
app.use(cors())
app.use(express.json())

// Lê o certificado base64 e converte pra buffer .p12
const certBase64 = fs.readFileSync(process.env.EFI_CERT_PATH, 'utf8')
const certificado = Buffer.from(certBase64, 'base64')

const options = {
  sandbox: false, // PRODUÇÃO = false
  client_id: process.env.EFI_CLIENT_ID,
  client_secret: process.env.EFI_CLIENT_SECRET,
  certificate: certificado,
  cert_base64: false
}

const efipay = new EfiPay(options)

app.post('/criar-cobranca', async (req, res) => {
  try {
    const { valor, nome, cpf } = req.body
    
    const body = {
      calendario: { expiracao: 3600 },
      devedor: { cpf, nome },
      valor: { original: Number(valor).toFixed(2) },
      chave: process.env.EFI_PIX_KEY,
      solicitacaoPagador: 'Pagamento Hotspot'
    }
    
    const cobranca = await efipay.pixCreateImmediateCharge([], body)
    
    const params = { id: cobranca.loc.id }
    const qrcode = await efipay.pixGenerateQRCode(params)
    
    res.status(200).json({
      txid: cobranca.txid,
      pixCopiaECola: qrcode.qrcode,
      qrcode: qrcode.imagemQrcode
    })
    
  } catch (error) {
    console.error('Erro Efí:', error.data || error.message)
    res.status(500).json({ error: error.data?.mensagem || error.message })
  }
})

const PORT = process.env.PORT || 10000
app.listen(PORT, () => {
  console.log('Servidor rodando na porta', PORT)
})
