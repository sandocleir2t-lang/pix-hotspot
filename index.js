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
  passphrase: '' // STRING VAZIA - ISSO RESOLVE O ERR_INVALID_ARG_TYPE
})

// Configuração do axios pra Efí
const efíApi = axios.create({
  baseURL: 'https://api.efipay.com.br',
  httpsAgent: agent,
  headers: {
    'Content-Type': 'application/json'
  }
})

// Sua rota aqui
app.get('/', (req, res) => {
  res.send('API Pix Hotspot rodando')
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`Rodando na porta ${PORT}`))
