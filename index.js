const express = require("express");
const EfiPay = require("sdk-node-apis-efi");
const QRCode = require("qrcode");

const app = express();
app.use(express.json());

const efi = new EfiPay({
  client_id: process.env.EFI_CLIENT_ID,
  client_secret: process.env.EFI_CLIENT_SECRET,
  certificate: Buffer.from(process.env.EFI_CERT_BASE64, "base64"),
  sandbox: false,
});

app.get("/", (req, res) => {
  res.send("Pix Hotspot Online ✅");
});

app.get("/pix", async (req, res) => {
  try {
    const valor = req.query.valor || "10.00";
    
    const body = {
      calendario: { expiracao: 3600 },
      valor: { original: valor },
      chave: process.env.EFI_PIX_KEY,
      solicitacaoPagador: "Acesso Wi-Fi Hotspot"
    };

    const pix = await efi.pixCreateImmediateCharge([], body);
    const qr = await efi.pixGenerateQRCode({ id: pix.loc.id });
    const qrbase64 = await QRCode.toDataURL(qr.qrcode);

    res.json({
      txid: pix.txid,
      pixCopiaECola: qr.qrcode,
      qrcode: qrbase64,
      valor: valor
    });
  } catch (error) {
    console.error("ERRO COMPLETO EFI:", JSON.stringify(error, null, 2));
    res.status(500).json({ 
      error: "Erro ao gerar Pix",
      codigo: error.code,
      nome: error.error,
      detalhe: error.error_description || error.message,
      erro_completo: error
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
