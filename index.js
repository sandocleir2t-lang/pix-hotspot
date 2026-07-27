require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { EfiPay } = require('sdk-node-apis-efi');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve arquivos estáticos da RAIZ (index.html do portal roxinho se tiver)
app.use(express.static(__dirname));

// ========= BANCO VOUCHER SLSDWB =========
const BANCO_PATH = path.join(__dirname, 'banco.json');
function loadBanco() {
  try {
    if (!fs.existsSync(BANCO_PATH)) {
      fs.writeFileSync(BANCO_PATH, JSON.stringify([{ voucher: 'SLSDWB', usado: false, fixo: true, tipo: '3H', criado: new Date().toISOString() }], null, 2));
    }
    return JSON.parse(fs.readFileSync(BANCO_PATH, 'utf8'));
  } catch (e) { return []; }
}
function saveBanco(data) {
  fs.writeFileSync(BANCO_PATH, JSON.stringify(data, null, 2));
}

// ========= EFI =========
const envsObrigatorias = ['EFI_CLIENT_ID','EFI_CLIENT_SECRET','EFI_PIX_KEY','EFI_CERT_P12'];
let efipay = null;
let efiOk = true;
for (const env of envsObrigatorias) {
  if (!process.env[env]) {
    console.warn(`⚠️ Variável ${env} não configurada! Modo voucher apenas.`);
    efiOk = false;
  }
}
if (efiOk) {
  try {
    efipay = new EfiPay({
      client_id: process.env.EFI_CLIENT_ID,
      client_secret: process.env.EFI_CLIENT_SECRET,
      certificate: Buffer.from(process.env.EFI_CERT_P12, 'base64'),
      password: process.env.EFI_CERT_PASSWORD || '',
      sandbox: false
    });
    console.log('✅ Efí configurada com sucesso');
  } catch (e) {
    console.error('❌ Erro Efí:', e.message);
    efiOk = false;
  }
}

// ========= ROTAS PIX =========
app.post('/criar-cobranca', async (req, res) => {
  try {
    if (!efiOk) return res.status(500).json({ erro: 'Efí não configurada' });
    const { valor } = req.body;
    if (!valor) return res.status(400).json({ erro: 'Valor é obrigatório' });
    const body = {
      calendario: { expiracao: 3600 },
      valor: { original: Number(valor).toFixed(2) },
      chave: process.env.EFI_PIX_KEY,
      solicitacaoPagador: 'Pagamento Hotspot'
    };
    const cobranca = await efipay.pixCreateImmediateCharge([], body);
    const qrcode = await efipay.pixGenerateQRCode({ id: cobranca.loc.id });
    res.json({ txid: cobranca.txid, qrcode: qrcode.qrcode, imagemQrcode: qrcode.imagemQrcode, copiaECola: qrcode.qrcode });
  } catch (error) {
    console.error('Erro ao criar cobrança:', error);
    res.status(500).json({ erro: error.message });
  }
});

// Alias para o portal chamar
app.get('/api/gerar-pix', (req,res)=>{
  res.json({ ok: true, msg: 'Use POST /criar-cobranca com {valor}' });
});

// ========= ROTAS PORTAL =========
app.get('/', (req, res) => {
  // Se tiver index.html na raiz, serve ele (portal roxinho), senão JSON
  const indexPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  res.json({ status: 'API Pix Online + Voucher SLSDWB V2', efi: efiOk ? 'OK' : 'MODO VOUCHER', admin: '/admin' });
});

// ========= ROTAS ADMIN - CORRIGE Cannot GET /admin =========
app.get('/admin', (req, res) => {
  const adminPath = path.join(__dirname, 'admin.html');
  if (fs.existsSync(adminPath)) return res.sendFile(adminPath);
  res.send(`
  <html><head><title>SLS ADMIN V2</title><meta name="viewport" content="width=device-width, initial-scale=1"></head>
  <body style="font-family:sans-serif;padding:20px;background:#0f0f1a;color:#fff">
    <h2>SLS WIFI EVENTOS - ADMIN V6.2 FIX</h2>
    <p>Efí: ${efiOk ? '✅ OK' : '⚠️ MODO VOUCHER'} | Banco: <span id="count"></span></p>
    <button onclick="fetch('/api/limpar-tudo',{method:'POST'}).then(()=>location.reload())" style="padding:15px;background:#ff0055;color:#fff;border:none;width:100%;margin-bottom:10px;border-radius:8px;font-weight:bold">LIMPAR TUDO</button>
    <button onclick="fetch('/api/gerar-vouchers',{method:'POST'}).then(r=>r.json()).then(d=>{alert('Gerados!');location.reload()})" style="padding:15px;background:#00ff88;color:#000;border:none;width:100%;border-radius:8px;font-weight:bold">GERAR 4 VOUCHERS NOVOS</button>
    <hr style="margin:20px 0;border-color:#333">
    <h3>Banco atual:</h3>
    <pre id="banco" style="background:#1a1a2e;padding:15px;overflow:auto;border-radius:8px"></pre>
    <script>fetch('/api/banco').then(r=>r.json()).then(d=>{document.getElementById('banco').innerText=JSON.stringify(d,null,2);document.getElementById('count').innerText=d.length})</script>
  </body></html>`);
});

app.get('/api/banco', (req,res)=> res.json(loadBanco()));

app.post('/api/limpar-tudo', (req,res)=>{
  saveBanco([{ voucher: 'SLSDWB', usado: false, fixo: true, tipo: '3H', criado: new Date().toISOString() }]);
  console.log('SLS: BANCO LIMPO - mantido SLSDWB');
  res.json({ok:true});
});

app.post('/api/gerar-vouchers', (req,res)=>{
  const banco = loadBanco();
  const novos = [];
  for(let i=0;i<4;i++){
    const code = 'SLS' + Math.random().toString(36).substring(2,6).toUpperCase();
    novos.push({voucher: code, usado:false, criado: new Date().toISOString(), tipo: '3H'});
  }
  const slsdwb = banco.find(b=>b.voucher==='SLSDWB') || { voucher: 'SLSDWB', usado:false, fixo:true, tipo:'3H', criado: new Date().toISOString() };
  const final = [slsdwb, ...novos];
  saveBanco(final);
  res.json(final);
});

app.post('/api/usar-voucher', (req,res)=>{
  const { voucher, mac, ip } = req.body;
  const banco = loadBanco();
  const found = banco.find(b=> b.voucher.toUpperCase() === (voucher||'').toUpperCase());
  if(!found) return res.json({ok:false, msg:'Voucher inválido'});
  if(found.usado && !found.fixo) return res.json({ok:false, msg:'Voucher já usado'});
  if(!found.fixo) found.usado = true;
  found.ip = ip || req.ip || '10.5.50.200';
  found.mac = mac || '';
  found.liberar = true;
  found.liberado_em = new Date().toISOString();
  saveBanco(banco);
  console.log(`SLS: LIBERANDO ${found.voucher} para ${found.ip}`);
  res.json({ok:true, msg:'SLS WIFI: Liberado 3H', ip: found.ip});
});

app.get('/api/pendentes', (req,res)=>{
  const banco = loadBanco();
  res.json(banco.filter(b=>b.liberar));
});

app.post('/api/confirmar-liberacao', (req,res)=>{
  const { voucher } = req.body;
  const banco = loadBanco();
  const found = banco.find(b=>b.voucher===voucher);
  if(found) found.liberar = false;
  saveBanco(banco);
  res.json({ok:true});
});

// ========= START CORRIGIDO =========
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`📍 Ambiente: ${process.env.NODE_ENV || 'desenvolvimento'}`);
  console.log(`🔗 Admin: /admin | Portal: / | Voucher fixo: SLSDWB`);
});
