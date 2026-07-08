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
app.listen(PORT, () => console.log(`Rodando na porta ${PORT}`))
