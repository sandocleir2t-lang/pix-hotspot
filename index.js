} catch (error) {
  console.error("ERRO EFI:", error);
  res.status(500).json({ 
    erro: true,
    codigo: error.code || "SEM_CODIGO",
    mensagem: error.error_description || error.message,
    detalhe: error
  });
}
