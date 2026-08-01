const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const EfiPay = require('sdk-node-apis-efi');
const { RouterOSClient } = require('node-routeros');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const certPath = path.join(__dirname, 'certs', 'hotspot-producao.p12');
if (fs.existsSync(certPath)) console.log(`✅ Certificado ${fs.statSync(certPath).size} bytes OK`);
else console.error('❌ Certificado NAO encontrado');

const efiOpt = {
  sandbox: false,
  client_id: process.env.EFI_CLIENT_ID,
  client_secret: process.env.EFI_CLIENT_SECRET,
  certificate: certPath,
  cert_base64: false
};

const PLANOS = {
  '3': { valor: '3.00', profile: '1HORA', tempo: '1h' },
  '5': { valor: '5.00', profile: '2HORAS', tempo: '2h' },
  '12': { valor: '12.00', profile: 'EVENTO', tempo: '12h' }
};
const getPlano = (v) => PLANOS[String(v).replace('.00','')] || PLANOS[String(v)];
const txs = new Map();

async function liberarMikrotik(mac, plano) {
  const client = new RouterOSClient({ host: process.env.MIKROTIK_HOST, user: process.env.MIKROTIK_USER, password: process.env.MIKROTIK_PASS });
  const conn = await client.connect();
  const user = `sls_${(mac||'XXXX').replace(/:/g,'').slice(-4)}_${Math.floor(Math.random()*900+100)}`;
  await conn.write('/ip/hotspot/user/add', [`=name=${user}`, `=password=${user}`, `=profile=${plano.profile}`, `=limit-uptime=${plano.tempo}`, `=comment=${mac}`]);
  await client.close();
  return { username: user, password: user };
}

app.post('/api/criar-pix', async (req, res) => {
  try {
    const plano = getPlano(req.body.valor);
    if (!plano) return res.status(400).json({ erro: 'Plano invalido, use 3, 5 ou 12' });
    const efi = new EfiPay(efiOpt);
    const body = { calendario: { expiracao: 3600 }, valor: { original: plano.valor }, chave: process.env.EFI_CHAVE_PIX, solicitacaoPagador: `SLS WIFI ${plano.profile}` };
    const cob = await efi.pixCreateImmediateCharge({}, body);
    const qr = await efi.pixGenerateQRCode({ id: cob.loc.id });
    txs.set(cob.txid, { mac: req.body.mac, plano, status: 'ATIVA' });
    res.json({ txid: cob.txid, qrcode: qr.imagemQrcode, pixCopiaECola: qr.qrcode });
  } catch (e) { console.error(e); res.status(500).json({ erro: e.message }); }
});

app.get('/api/status-pix/:txid', async (req, res) => {
  try {
    const local = txs.get(req.params.txid);
    if (!local) return res.status(404).json({ status: 'NAO_ENCONTRADO' });
    const efi = new EfiPay(efiOpt);
    const det = await efi.pixDetailCharge({ txid: req.params.txid });
    if (det.status === 'CONCLUIDA' && local.status !== 'CONCLUIDA') {
      local.status = 'CONCLUIDA';
      const cred = await liberarMikrotik(req.query.mac || local.mac, local.plano);
      return res.json({ status: 'CONCLUIDA', ...cred });
    }
    res.json({ status: det.status });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.post('/api/gerar-voucher', async (req, res) => {
  try {
    if (req.body.codigo === 'TESTE10') {
      const p = getPlano(req.body.valor || '12');
      const c = await liberarMikrotik(req.body.mac, p);
      return res.json({ ok: true, ...c });
    }
    res.status(401).json({ ok: false, erro: 'Voucher invalido' });
  } catch (e) { res.status(500).json({ ok: false, erro: e.message }); }
});

app.listen(process.env.PORT || 3000, () => console.log('SLS WIFI RODANDO - 99,99% FIX'));
