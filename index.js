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
