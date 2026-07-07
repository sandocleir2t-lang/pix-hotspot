const express=require("express");
const EfiPay=require("efi-pay-sdk");
const QRCode=require("qrcode");
const app=express();
app.use(express.json());
const efi=new EfiPay({client_id:process.env.EFI_CLIENT_ID,client_secret:process.env.EFI_CLIENT_SECRET,sandbox:false,certificate:Buffer.from(process.env.EFI_CERT_BASE64,"base64")});
app.get("/",(req,res)=>res.send("Pix Hotspot Online ✅"));
app.post("/pix",(req,res)=>{const {valor,descricao}=req.body;efi.pixCreateImmediateCharge([],{calendario:{expiracao:3600},valor:{original:valor},chave:process.env.EFI_PIX_KEY,solicitacaoPagador:descricao}).then(c=>efi.pixGenerateQRCode({id:c.loc.id})).then(q=>QRCode.toDataURL(q.qrcode)).then(img=>res.json({imagemQrcode:img,pixCopiaECola:q.qrcode})).catch(e=>res.status(500).json(e))});
app.listen(process.env.PORT||3000);
