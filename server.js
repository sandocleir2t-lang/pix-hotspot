const express = require('express');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 10000;
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({extended:true}));

let filaLiberacao = [];
let pagamentos = {};
try{
  if(fs.existsSync('/tmp/fila.json')) filaLiberacao = JSON.parse(fs.readFileSync('/tmp/fila.json','utf8'));
  if(fs.existsSync('/tmp/pags.json')) pagamentos = JSON.parse(fs.readFileSync('/tmp/pags.json','utf8'));
}catch(e){}
function salvar(){
  try{
    fs.writeFileSync('/tmp/fila.json', JSON.stringify(filaLiberacao));
    fs.writeFileSync('/tmp/pags.json', JSON.stringify(pagamentos));
  }catch(e){}
}

// TABELA CORRETA - SEM R$2,00
const PLANOS = {
  '3.00': { profile: '1HORA', tempo: '1h', nome: '1 HORA' },
  '5.00': { profile: '2HORAS', tempo: '2h', nome: '2 HORAS' },
  '12.00': { profile: 'EVENTO', tempo: '12h', nome: 'EVENTO TODO' }
};
function getPlano(valor){
  let v = String(valor).replace('R$','').replace(',','.').trim();
  if(!isNaN(v)) v = Number(v).toFixed(2);
  return PLANOS[v] || PLANOS['3.00'];
}

let efiInstance = null;
function getEfiInstance(){
  if(efiInstance) return efiInstance;
  const mod = require('sdk-node-apis-efi');
  const EfiPay = mod.EfiPay || mod.default || mod;
  // USA ARQUIVO DIRETO - NAO BASE64
  const local1 = path.join(__dirname, 'certs', 'hotspot-producao.p12');
  const certPath = fs.existsSync(local1)? local1 : './certs/certificado.p12';
  console.log(`✅ Certificado usado: ${certPath} - ${fs.existsSync(certPath)? fs.statSync(certPath).size+' bytes' : 'NAO ACHOU'}`);
  const options = { sandbox: false, client_id: process.env.EFI_CLIENT_ID, client_secret: process.env.EFI_CLIENT_SECRET, certificate: certPath, cert_base64: false };
  efiInstance = new EfiPay(options);
  return efiInstance;
}

app.get('/api/liberacoes',(req,res)=>{
  try{
    if(filaLiberacao.length===0 && fs.existsSync('/tmp/fila.json')){
      const tmp = JSON.parse(fs.readFileSync('/tmp/fila.json','utf8'));
      if(Array.isArray(tmp) && tmp.length>0) filaLiberacao = tmp;
    }
  }catch(e){}
  if(req.query.rsc!==undefined){
    let cmds="";
    filaLiberacao.forEach(f=>{
      const macSafe = (f.mac||'').trim();
      if(!macSafe) return;
      const plano = getPlano(f.valor);
      // AGORA USA PROFILE CERTO
      cmds+=`/ip hotspot user remove [find name="${macSafe}"]\n`;
      cmds+=`/ip hotspot user add name="${macSafe}" password="${macSafe}" profile=${plano.profile} limit-uptime=${plano.tempo} server=all comment="${f.txid} R$${f.valor}"\n`;
    });
    if(cmds==="") cmds=":log info \"SLS: Fila vazia\"\n";
    res.set('Content-Type','text/plain'); return res.send(cmds);
  }
  if(req.query.clear!==undefined){ filaLiberacao=[]; salvar(); return res.json([]); }
  res.json(filaLiberacao);
});

app.get('/api/pagamentos', (req,res)=> res.json(pagamentos));
app.get('/api/debug', (req,res)=> res.json({fila: filaLiberacao, pagamentos}));
app.get('/api/forcar/:ip/:mac', (req,res)=>{
  const ip = req.params.ip; const mac = req.params.mac;
  if(!filaLiberacao.find(x=>x.mac===mac)){
    filaLiberacao.push({ip, mac, valor:"12.00", txid:"MANUAL", data: new Date().toISOString()}); salvar();
  }
  return res.json({ok:true, fila: filaLiberacao});
});
app.get('/api/consumido',(req,res)=>{ const ip = (req.query.ip||"").trim(); filaLiberacao = filaLiberacao.filter(x => x.ip!== ip); salvar(); res.send("ok "+ip); });
app.get('/api/reset',(req,res)=>{ filaLiberacao=[]; pagamentos={}; salvar(); res.set('Content-Type','text/plain'); res.send("RESET OK"); });

// VOUCHER - QUE FALTAVA
app.post('/api/gerar-voucher', (req,res)=>{
  const { mac, valor, codigo, senha } = req.body;
  const ip = req.body.ip || "0.0.0.0";
  if(codigo === 'TESTE10' && senha === '123'){
    const plano = getPlano(valor || '12.00');
    if(!filaLiberacao.find(x=>x.mac===mac)){
      filaLiberacao.push({ip, mac, valor: plano? '12.00' : '3.00', txid: `VOUCHER-${codigo}`, data: new Date().toISOString()});
      salvar();
    }
    return res.json({ok:true, status:'CONCLUIDA'});
  }
  return res.status(401).json({ok:false, erro:'Voucher invalido'});
});

async function handlerPix(req,res){
  try{
    const forwarded = req.headers['x-forwarded-for'] || "";
    const ip = (forwarded.split(',')[0].trim() || req.body.ip || req.ip || "0.0.0.0").trim();
    const mac = (req.body.mac || "").trim();
    let valor = (req.body.valor || "3.00").toString().replace("R$","").replace(",",".").trim();
    if(!valor || isNaN(Number(valor))) valor="3.00";
    valor = Number(valor).toFixed(2);
    const efi = getEfiInstance();
    const chavePix = process.env.EFI_PIX_KEY || process.env.EFI_CHAVE_PIX;
    const body = { calendario:{expiracao:3600}, valor:{original: valor}, chave: chavePix, solicitacaoPagador: `SLS WIFI ${ip} ${mac} R$${valor}` };
    const charge = await efi.pixCreateImmediateCharge([], body);
    const qr = await efi.pixGenerateQRCode({id: charge.loc.id});
    pagamentos[charge.txid] = {ip, mac, status:"pendente", txid: charge.txid, valor, criado: Date.now()}; salvar();
    return res.json({ txid: charge.txid, id: charge.txid, pixCopiaECola: qr.qrcode, qrcode: qr.imagemQrcode });
  }catch(err){ console.error(err); return res.status(500).json({error: err.message}); }
}
app.post('/api/gerar-pix', handlerPix);
app.post('/api/criar-pix', handlerPix);
app.post('/api/pix', handlerPix);

async function handlerStatus(req,res){
  try{
    const id = (req.params.id || "").trim();
    const p = pagamentos[id];
    if(!p){ return res.json({status:"pendente", txid:id}); }
    if(p.status === "pago"){ return res.json({status:"CONCLUIDA"}); }
    const efi = getEfiInstance();
    const d = await efi.pixDetailCharge({txid: p.txid});
    if(d.status === "CONCLUIDA"){
      p.status = "pago"; salvar();
      if(!filaLiberacao.find(x=>x.ip===p.ip)){ filaLiberacao.push({ip:p.ip, mac:p.mac, valor:p.valor, txid:p.txid, data: new Date().toISOString()}); salvar(); }
      return res.json({status:"CONCLUIDA"});
    }
    return res.json({status: d.status || "pendente"});
  }catch(e){ return res.json({status:"pendente", erro:e.message}); }
}
app.get('/api/status/:id', handlerStatus);
app.use(express.static(path.join(__dirname,'public')));
app.get('*', (req,res)=> res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,'0.0.0.0',()=>console.log("SLS WIFI 100% RODANDO "+PORT));
