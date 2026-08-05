// server.js v9.2 SLS WIFI - FIX 404 + POLLING FREE - SEU 116 LINHAS CONSERTADO
const express = require('express');
const fs = require('fs');
const path = require('path');
const EfiPay = require('sdk-node-apis-efi');
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PLANOS = {
  "1H": { valor: 2.00, tempo: 60, vel: "5M/5M", nome: "1 HORA - 5MB" },
  "2H": { valor: 5.00, tempo: 120, vel: "10M/10M", nome: "2 HORAS - 10MB" },
  "EVENTO": { valor: 12.00, tempo: 720, vel: "10M/10M", nome: "EVENTO 12H" }
};

let certPath = './certs/certificado.p12';
try {
  if (process.env.EFI_CERT_P12) {
    const buffer = Buffer.from(process.env.EFI_CERT_P12, 'base64');
    fs.writeFileSync('/tmp/cert.p12', buffer);
    certPath = '/tmp/cert.p12';
    console.log('Certificado criado em /tmp/cert.p12');
  }
} catch(e){ console.log('Erro cert', e.message); }

let fila = [];
const FILA_PATH = '/tmp/fila.json';
try { if(fs.existsSync(FILA_PATH)) fila = JSON.parse(fs.readFileSync(FILA_PATH)); } catch(e){}
const salvar = () => { try{fs.writeFileSync(FILA_PATH, JSON.stringify(fila))}catch(e){} };

const efipay = new EfiPay({
  sandbox: false,
  client_id: process.env.EFI_CLIENT_ID,
  client_secret: process.env.EFI_CLIENT_SECRET,
  certificate: certPath,
  passphrase: process.env.CERT_PASSWORD || ''
});

const getExp = (min) => Date.now() + (min * 60 * 1000);

app.get('/', async (req, res) => {
  const { plano, valor, mac, ip } = req.query;
  if(plano && PLANOS[plano]){
     try{
       const p = PLANOS[plano];
       const body = {
         calendario: { expiracao: 600 },
         valor: { original: p.valor.toFixed(2) },
         chave: process.env.EFI_PIX_KEY,
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
       return res.send(`
         <html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#1a0b2e;color:#fff;font-family:Arial;text-align:center;padding:20px}.qr{background:#fff;padding:15px;border-radius:15px;width:280px;margin:20px auto}h1{color:#a855f7}</style></head><body>
         <h1>SLS WIFI - ${p.nome}</h1><h2>R$ ${p.valor.toFixed(2)}</h2>
         <div class="qr"><img src="${qr.imagemQrcode}" style="width:100%"><p style="color:#000;font-size:10px;word-break:break-all">${qr.qrcode}</p></div>
         <p id="status">Aguardando pagamento... Liberação automática!</p>
         <script>
           let txid="${cob.txid}";
           setInterval(async()=>{
             let r=await fetch('/status/'+txid); let d=await r.json();
             if(d.status==='CONCLUIDA'){ document.getElementById('status').innerHTML='<h2 style=color:#22c55e>✅ PAGO! LIBERADO!</h2>'; setTimeout(()=>{ window.location.href='http://10.5.50.1'; },2000); }
           },3000);
         </script></body></html>`);
     }catch(e){ return res.send('Erro gerar PIX: '+e.message); }
  }
  res.send('SLS v9.2 FIX FREE OK - Use com?plano=1H&mac=XX&ip=XX');
});

app.post('/webhook', async (req, res) => {
  console.log('WEBHOOK RECEBIDO:', JSON.stringify(req.body));
  const pixList = req.body.pix || [];
  for(let p of pixList){
    let idx = fila.findIndex(f=>f.txid===p.txid);
    if(idx>=0){ fila[idx].status='CONCLUIDA'; fila[idx].expiraEm=getExp(fila[idx].tempoMin); salvar(); console.log('Liberado local', p.txid); }
    else {
      try{
        console.log('Fila vazia, recuperando da EFI:', p.txid);
        const detalhe = await efipay.pixDetailCharge({ txid: p.txid });
        const info = {}; (detalhe.infoAdicionais||[]).forEach(i=> info[i.nome]=i.valor);
        if(info.plano){ fila.push({ txid: p.txid, plano: info.plano, mac: info.mac, ip: info.ip, tempoMin: parseInt(info.tempo), velocidade: info.velocidade, status:'CONCLUIDA', expiraEm: getExp(parseInt(info.tempo)), criadoEm: Date.now(), recuperado: true }); salvar(); console.log('RECUPERADO!'); }
      }catch(err){ console.error('Erro recuperar', err.message); }
    }
  }
  res.json({ok:true});
});

// --- FIX 1: AGORA APAGA DA FILA DE VERDADE ---
app.get('/api/liberacoes', (req,res)=>{ const ativos = fila.filter(f=> f.status==='CONCLUIDA' && f.expiraEm > Date.now()); res.json(ativos); });
app.get('/api/consumido/:ip', (req,res)=>{
  console.log('CONSUMIDO:
