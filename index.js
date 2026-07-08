const express = require('express')
const cors = require('cors')
const https = require('https')
const axios = require('axios')

const app = express()
app.use(cors())
app.use(express.json())

// Lê o certificado base64 da variável CERT_P12 do Render
const p12Base64 = process.env.CERT_P12
const p12Buffer = Buffer.from(p12Base64, 'base64')

// Cria o agente HTTPS pra Efí - certificado SEM SENHA
const agent = new https.Agent({
  pfx: p12Buffer,
  passphrase: '' 
})

// Configuração do axios pra Efí - SEM ACENTO
const efiApi = axios.create({
  baseURL: 'https://api.efipay.com.br',
  httpsAgent: agent,
  headers: {
    'Content-Type': 'application/json'
  }
})

// Rota raiz
app.get('/', (req, res) => {
  res.send('API Pix Hotspot rodando')
})

// Rota de teste mTLS
app.get('/teste-efi', async (req, res) => {
  try {
    const auth = Buffer.from(`${process.env.EFI_CLIENT_ID}:${process.env.EFI_CLIENT_SECRET}`).toString('base64')
    
    const tokenResponse = await efiApi.post('/v1/oauth/token', 
      { grant_type: 'client_credentials' },
      { headers: { Authorization: `Basic ${auth}` } }
    )
    
    const accessToken = tokenResponse.data.access_token
    
    const cobResponse = await efiApi.post('/v2/cob', 
      {
        calendario: { expiracao: 3600 },
        valor: { original: '0.01' },
        chave: process.env.EFI_PIX_KEY
      },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    
    res.json({
      status: 'MTLS FUNCIONOU!',
      txid: cobResponse.data.txid,
      copiaECola: cobResponse.data.pixCopiaECola
    })
    
  } catch (err) {
    res.status(500).json({ 
      erro: 'Falhou',
       detalhe: err.response?.data || err.message
    })
  }
});

const PORT = process.env.PORT || 3000
// ROTA PRA GERAR COBRANÇA PIX DINÂMICA
app.post('/cobrar', async (req, res) => {
  try {
    const { valor, descricao, devedor } = req.body

    if (!valor) {
      return res.status(400).json({ erro: 'Envie o valor. Ex: {"valor": "5.00"}' })
    }

    // 1. Pega token OAuth da Efí
    const auth = Buffer.from(`${process.env.EFI_CLIENT_ID}:${process.env.EFI_CLIENT_SECRET}`).toString('base64')
    
    const tokenResponse = await efiApi.post('/v1/oauth/token', 
      { grant_type: 'client_credentials' },
      { headers: { Authorization: `Basic ${auth}` } }
    )
    
    const accessToken = tokenResponse.data.access_token

    // 2. Monta corpo da cobrança
    const bodyCob = {
      calendario: { expiracao: 3600 },
      valor: { original: valor.toString() },
      chave: process.env.EFI_PIX_KEY,
      solicitacaoPagador: descricao || 'Acesso WiFi Hotspot'
    }

    if (devedor && devedor.nome && devedor.cpf) {
      bodyCob.devedor = {
        nome: devedor.nome,
        cpf: devedor.cpf
      }
    }
    
    // 3. Cria cobrança
    const cobResponse = await efiApi.post('/v2/cob', bodyCob, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })

    const { txid, pixCopiaECola, loc } = cobResponse.data

    // 4. Gera QR Code em base64
    const qrcodeResponse = await efiApi.get(`/v2/loc/${loc.id}/qrcode`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })

    const qrCodeBase64 = qrcodeResponse.data.imagemQrcode
    
    // 5. Retorna tudo pro frontend
    res.json({
      status: 'Cobranca criada',
      txid: txid,
      valor: valor,
      expiraEm: '1 hora',
      pixCopiaECola: pixCopiaECola,
      qrCode: `data:image/png;base64,${qrCodeBase64}`
    })
    
  } catch (err) {
    res.status(500).json({ 
      erro: 'Falha ao gerar cobrança',
      detalhe: err.response?.data || err.message 
    })
  }
})
app.listen(PORT, () => console.log(`Rodando na porta ${PORT}`))
