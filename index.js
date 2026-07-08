const express = require('express')
const EfiPay = require('sdk-node-apis-efi')
const app = express()
app.use(express.json())

// Config PRODUÇÃO
const options = {
  sandbox: false,
  client_id: process.env.EFI_CLIENT_ID,
  client_secret: process.env.EFI_CLIENT_SECRET,
  certificate: Buffer.from(process.env.EFI_CERT_BASE64, 'base64'),
  validateMtls: false
}
const efipay = new EfiPay(options)

// ROTA /PIX QUE TÁ FALTANDO
app.post('/pix', async (req, res) => {
  try {
    const body = {
      calendario: { expiracao: 3600 },
      valor: { original: req.body.valor || "5.00" },
      chave: process.env.EFI_PIX_KEY,
      solicitacaoPagador: "Hotspot SLS WIFI"
    }
    const response = await efipay.pixCreateImmediateCharge([], body)
    res.status(200).json(response)
  } catch (error) {
    console.log(error)
    res.status(500).json({ erro: "Erro ao gerar Pix", detalhes: error })
  }
})

const PORT = process.env.PORT || 10000
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`)
})
