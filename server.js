// SLS WIFI v9.0 FINAL - Anti-Deploy
const express = require('express');
const fs = require('fs');
const EfiPay = require('sdk-node-apis-efi');
const app = express();
app.use(express.json());
app.use(express.static('public'));

const PLANOS = {
  "1H": { valor: 2.00, tempo: 60, vel: "5M/5M" },
  "2H": { valor: 5.00, tempo: 120, vel: "10M/10M" },
  "EVENTO": { valor: 12.00, tempo: 720, vel: "10M/10M" }
};

let fila = [];
const FILA_PATH = '/tmp/fila.json';
try { if(fs.existsSync(FILA_PATH)) fila = JSON.parse(fs.readFileSync(FILA_PATH)); } catch(e){}
const salvar = () => { try{fs.writeFileSync(FILA_PATH, JSON.stringify(fila))}catch(e){} };

const efipay = new EfiPay({
  sandbox: false,
  client_id: process.env.EFI_CLIENT_ID,
  client_secret: process.env.EFI_CLIENT_SECRET,
  certificate: process.env.EFI_CERT_PATH || './certs/certificado.p12',
});

const getExp = (min) => Date.now() + (min * 60 * 1000);

// ROTA QUE GERA O PIX
app.post('/gerar', async (req, res) => {
  try{
    const { plano, mac, ip } = req.body;
    const p = PLANOS[plano];
    const body = {
      calendario: { expiracao: 600 },
      valor: { original: p.valor.toFixed(2) },
      chave: process.env.EFI_CHAVE_PIX,
      infoAdicionais: [
        { nome: "plano", valor: plano },
        { nome: "mac", valor: mac || "00:00:00:00" },
        { nome: "ip", valor: ip || "0.0.0.0" },
        { nome: "tempo", valor: String(p.tempo) },
        { nome: "velocidade", valor: p.vel }
      ]
    };
    const cob = await efipay.pixCreateImmediateCharge({}, body);
    const qr = await efipay.pixGenerateQRCode({ id: cob.loc.id });
    const item = { txid: cob.txid, plano, mac, ip, tempoMin: p.tempo, velocidade: p.vel, status: 'ATIVA', expiraEm: getExp(p.tempo), criadoEm: Date.now() };
    fila = fila.filter(f=>f.txid!==cob.txid); fila.push(item); salvar();
    res.json({ txid: cob.txid, qrcode: qr.qrcode, qrcode_imagem: qr.imagemQrcode });
  }catch(e){ console.error(e); res.status(500).json(e); }
});

// WEBHOOK COM RECUPERAÇÃO ANTI-DEPLOY
app.post('/webhook', async (req, res) => {
  console.log('Webhook:', JSON.stringify(req.body));
  const pixList = req.body.pix || [];
  for(let p of pixList){
    if(!p.txid) continue;
    let idx = fila.findIndex(f=>f.txid===p.txid);
    if(idx>=0){
      fila[idx].status='CONCLUIDA'; salvar();
      console.log('Liberado local:', p.txid);
    } else {
      // FILA APAGOU? RECUPERA DA EFI!
      try{
        console.log('Fila vazia, recuperando da EFI:', p.txid);
        const detalhe = await efipay.pixDetailCharge({ txid: p.txid });
        const info = {}; (detalhe.infoAdicionais||[]).forEach(i=> info[i.nome]=i.valor);
        if(info.plano){
          fila.push({ txid: p.txid, plano: info.plano, mac: info.mac, ip: info.ip, tempoMin: parseInt(info.tempo), velocidade: info.velocidade, status:'CONCLUIDA', expiraEm: getExp(parseInt(info.tempo)), criadoEm: Date.now(), recuperado: true });
          salvar(); console.log('RECUPERADO COM SUCESSO!');
        }
      }catch(err){ console.error('Erro recuperar', err); }
    }
  }
  res.json({ok:true});
});

// ROTAS QUE O MIKROTIK USA
app.get('/api/liberacoes', (req,res)=>{
  const ativos = fila.filter(f=> f.status==='CONCLUIDA' && f.expiraEm > Date.now());
  res.json(ativos);
});
app.get('/api/consumido/:ip', (req,res)=> res.json({ok:true}));
app.get('/status/:txid', (req,res)=> res.json(fila.find(f=>f.txid===req.params.txid) || {status:'NAO_ENCONTRADO'}));
app.get('/fila', (req,res)=> res.json(fila));
app.get('/', (req,res)=> res.send('SLS v9.0 OK - use /?mac=XX&ip=XX'));
app.get('/configurar-webhook', async (req,res)=>{
  try{ const r = await efipay.pixConfigWebhook({chave: process.env.EFI_CHAVE_PIX}, {webhookUrl: 'https://hotsport-pix-2.onrender.com/webhook'}); res.json(r); }catch(e){res.json(e)}
});

app.listen(process.env.PORT || 3000, ()=> console.log('SLS v9.0 RODANDO'));
