const express = require('express');
const path = require('path');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 10000;
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({extended:true}));

let filaLiberacao = [];
let pagamentos = {};
let efiInstance = null;
function getEfiInstance(){
  if(efiInstance) return efiInstance;
  const {EfiPay} = require('efipay');
  const fs = require('fs');
  const certPath = process.env.EFI_CERT_PATH || './certs/certificado.p12';
  if(!fs.existsSync(certPath)){
    throw new Error('Certificado não encontrado em '+certPath);
  }
  const options = {
    sandbox: false,
    client_id: process.env.EFI_CLIENT_ID,
    client_secret: process.env.EFI_CLIENT_SECRET,
    certificate: certPath,
  };
  efiInstance = new EfiPay(options);
  console.log("[EFI] OK Cert", fs.readFileSync(certPath).length, "bytes");
  return efiInstance;
}

// API - TEM QUE VIR ANTES DO STATIC E DO *
app.get('/api/liberacoes',(req,res)=>{
  if(req.query.rsc!==undefined){
    let cmds="";
    filaLiberacao.forEach(f=>{
      cmds+=`/ip hotspot user remove [find name="${f.mac}"]\n`;
      cmds+=`/ip hotspot user add name="${f.mac}" password="${f.mac}" profile=default limit-uptime=2h server=all\n`;
    });
    if(cmds==="") cmds=":log info \"SLS fila vazia\"\n";
    console.log("[RSC] gerado", filaLiberacao.length);
    res.set('Content-Type','text/plain');
    return res.send(cmds);
  }
  if(req.query.clear!==undefined){
    console.log("[CLEAR] limpando fila", filaLiberacao.length);
    filaLiberacao=[];
    return res.json([]);
  }
  console.log("[LIBERACOES] fila", filaLiberacao.length, filaLiberacao);
  res.json(filaLiberacao);
});

app.get('/api/consumido',(req,res)=>{
  const ip = (req.query.ip||"").trim();
  console.log("[CONSUMIDO] ip:", ip, "antes:", filaLiberacao.length);
  filaLiberacao = filaLiberacao.filter(x => x.ip !== ip);
  console.log("[CONSUMIDO] depois:", filaLiberacao.length);
  res.send("ok "+ip);
});

app.get('/api/reset',(req,res)=>{
  console.log("[RESET] limpando tudo! antes fila:", filaLiberacao.length);
  filaLiberacao=[];
  pagamentos={};
  res.set('Content-Type','text/plain');
  res.send("RESET OK");
});

async function handlerPix(req,res){
  try{
    const forwarded = req.headers['x-forwarded-for'] || "";
    const ip = (forwarded.split(',')[0].trim() || req.body.ip || req.ip || "0.0.0.0").trim();
    const mac = (req.body.mac || "").trim();
    let valor = (req.body.valor || "3.00").toString().replace("R$","").replace(",",".").trim();
    if(!valor || isNaN(Number(valor))) valor="3.00";
    const efi = getEfiInstance();
    const chavePix = process.env.EFI_PIX_KEY || process.env.EFI_CHAVE_PIX;
    const body = { calendario:{expiracao:3600}, valor:{original: Number(valor).toFixed(2)}, chave: chavePix, solicitacaoPagador: `SLS WIFI ${ip} ${mac}` };
    const charge = await efi.pixCreateImmediateCharge([], body);
    const qr = await efi.pixGenerateQRCode({id: charge.loc.id});
    pagamentos[charge.txid] = {ip, mac, status:"pendente", txid: charge.txid, valor, criado: Date.now()};
    console.log("[PIX OK]", charge.txid, ip, mac, valor);
    return res.json({ txid: charge.txid, id: charge.txid, pixCopiaECola: qr.qrcode, copiaECola: qr.qrcode, pix: qr.qrcode, qrcode: qr.imagemQrcode, imagemQrcode: qr.imagemQrcode });
  }catch(err){ console.error("[ERRO PIX]", err.message, err.data||err); return res.status(500).json({error: err.message}); }
}
app.post('/api/gerar-pix', handlerPix);
app.post('/api/criar-pix', handlerPix);
app.post('/api/pix', handlerPix);

async function handlerStatus(req,res){
  try{
    const id = (req.params.id || req.params.txid || "").trim();
    const p = pagamentos[id];
    if(!p){
      // Tenta achar por ip se o server reiniciou e perdeu memoria mas cliente ainda polla
      return res.json({status:"pendente"});
    }
    if(p.status === "pago"){
      return res.json({status:"CONCLUIDA", usuario:p.ip, senha:p.mac||"123456"});
    }
    const efi = getEfiInstance();
    const d = await efi.pixDetailCharge({txid: p.txid});
    if(d.status === "CONCLUIDA"){
      p.status = "pago";
      // Evita duplicado
      if(!filaLiberacao.find(x=>x.ip===p.ip)){
        filaLiberacao.push({ip:p.ip, mac:p.mac, valor:p.valor});
      }
      console.log("[PAGO]", p.ip, p.mac, "fila agora", filaLiberacao.length);
      return res.json({status:"CONCLUIDA", usuario:p.ip, senha:p.mac||"123456"});
    }
    return res.json({status: d.status || "pendente"});
  }catch(e){
    console.error("[ERRO STATUS]", e.message);
    return res.json({status:"pendente"});
  }
}
app.get('/api/status/:id', handlerStatus);
app.get('/api/status-pix/:id', handlerStatus);
app.get('/api/status/:txid', handlerStatus);

// STATIC DEPOIS DAS APIS
app.use(express.static(path.join(__dirname,'public')));
app.get('*', (req,res)=> res.sendFile(path.join(__dirname,'public','index.html')));

app.listen(PORT,'0.0.0.0',()=>console.log("SLS RODANDO "+PORT));
