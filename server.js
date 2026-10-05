const express = require("express");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 10000;

// ======================================================
// CONFIGURAÇÕES
// ======================================================

const PUBLIC_URL =
  process.env.PUBLIC_URL || "https://luxor-store-1.onrender.com";

const PAGBANK_ENV =
  (process.env.PAGBANK_ENV || "sandbox").toLowerCase();

const PAGBANK_TOKEN = process.env.PAGBANK_TOKEN;

// Ambiente PagBank
const PAGBANK_API =
  PAGBANK_ENV === "production"
    ? "https://api.pagseguro.com"
    : "https://sandbox.api.pagseguro.com";

// ======================================================
// MIDDLEWARES
// ======================================================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Arquivos HTML, imagens etc. que estão na raiz do projeto
app.use(express.static(__dirname));

// ======================================================
// PÁGINAS
// ======================================================

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/checkout.html", (req, res) => {
  res.sendFile(path.join(__dirname, "checkout.html"));
});

app.get("/admin.html", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

app.get("/pagamento-retorno.html", (req, res) => {
  res.sendFile(path.join(__dirname, "pagamento-retorno.html"));
});

// ======================================================
// TESTE DO SERVIDOR
// ======================================================

app.get("/api", (req, res) => {
  res.json({
    ok: true,
    mensagem: "Servidor LUXOR funcionando."
  });
});

// ======================================================
// CRIAR PEDIDO + CHECKOUT PAGBANK
// ======================================================

app.post("/api/pedidos", async (req, res) => {
  try {
    // --------------------------------------------------
    // Verifica token do PagBank
    // --------------------------------------------------

    if (!PAGBANK_TOKEN) {
      return res.status(500).json({
        ok: false,
        error:
          "PAGBANK_TOKEN não configurado no Render."
      });
    }

    // --------------------------------------------------
    // Dados recebidos do checkout.html
    // --------------------------------------------------

    const { cliente, produto } = req.body;

    if (!cliente) {
      return res.status(400).json({
        ok: false,
        error: "Dados do cliente não foram enviados."
      });
    }

    if (!produto) {
      return res.status(400).json({
        ok: false,
        error: "Produto não foi enviado."
      });
    }

    // --------------------------------------------------
    // Validação básica
    // --------------------------------------------------

    const nome = String(cliente.nome || "").trim();
    const email = String(cliente.email || "").trim();

    const produtoNome =
      String(produto.nome || "Relógio Premium importado").trim();

    const preco = Number(produto.preco);

    if (!nome) {
      return res.status(400).json({
        ok: false,
        error: "Informe o nome completo."
      });
    }

    if (!email) {
      return res.status(400).json({
        ok: false,
        error: "Informe o e-mail."
      });
    }

    if (!Number.isFinite(preco) || preco <= 0) {
      return res.status(400).json({
        ok: false,
        error: "Valor do produto inválido."
      });
    }

    // --------------------------------------------------
    // ID único do pedido
    // --------------------------------------------------

    const pedidoId =
      "LUXOR-" +
      Date.now() +
      "-" +
      Math.floor(Math.random() * 1000);

    // PagBank trabalha com centavos
    const valorCentavos = Math.round(preco * 100);

    // --------------------------------------------------
    // Cliente
    // --------------------------------------------------

    const telefone =
      String(cliente.telefone || "").replace(/\D/g, "");

    const cpf =
      String(cliente.cpf || "").replace(/\D/g, "");

    let customer = {
      name: nome,
      email: email
    };

    // CPF somente se tiver tamanho válido
    if (cpf.length === 11 || cpf.length === 14) {
      customer.tax_id = cpf;
    }

    // Telefone brasileiro
    if (telefone.length >= 10) {
      let numeroTelefone = telefone;

      // Remove 55 caso o cliente tenha digitado o código do país
      if (numeroTelefone.startsWith("55")) {
        numeroTelefone = numeroTelefone.substring(2);
      }

      const area = numeroTelefone.substring(0, 2);
      const numero = numeroTelefone.substring(2);

      if (area && numero) {
        customer.phone = {
          country: "55",
          area: area,
          number: numero
        };
      }
    }

    // --------------------------------------------------
    // Checkout PagBank
    // --------------------------------------------------

    const checkoutBody = {
      reference_id: pedidoId,

      items: [
        {
          reference_id: String(
            produto.id || "1"
          ),

          name: produtoNome,

          quantity: 1,

          unit_amount: valorCentavos
        }
      ],

      payment_methods: [
        {
          type: "CREDIT_CARD"
        },
        {
          type: "PIX"
        },
        {
          type: "BOLETO"
        }
      ],

      customer: customer,

      customer_modifiable: true,

      redirect_url:
        PUBLIC_URL + "/pagamento-retorno.html",

      return_url:
        PUBLIC_URL + "/index.html",

      notification_urls: [
        PUBLIC_URL + "/api/pagbank/webhook"
      ],

      payment_notification_urls: [
        PUBLIC_URL + "/api/pagbank/webhook"
      ]
    };

    console.log("Criando checkout PagBank...");
    console.log("Pedido:", pedidoId);
    console.log("Produto:", produtoNome);
    console.log("Valor:", preco);
    console.log("Ambiente:", PAGBANK_ENV);

    // --------------------------------------------------
    // Chamada para o PagBank
    // --------------------------------------------------

    const pagbankResponse = await fetch(
      PAGBANK_API + "/checkouts",
      {
        method: "POST",

        headers: {
          "Authorization":
            "Bearer " + PAGBANK_TOKEN,

          "Content-Type":
            "application/json",

          "Accept":
            "application/json"
        },

        body: JSON.stringify(checkoutBody)
      }
    );

    // --------------------------------------------------
    // Lê resposta com segurança
    // --------------------------------------------------

    const respostaTexto =
      await pagbankResponse.text();

    let pagbankData;

    try {
      pagbankData =
        JSON.parse(respostaTexto);
    } catch (erro) {
      console.error(
        "Resposta não-JSON do PagBank:",
        respostaTexto
      );

      return res.status(502).json({
        ok: false,
        error:
          "O PagBank retornou uma resposta inválida.",
        detalhes:
          respostaTexto.substring(0, 500)
      });
    }

    // --------------------------------------------------
    // Erro retornado pelo PagBank
    // --------------------------------------------------

    if (!pagbankResponse.ok) {
      console.error(
        "Erro PagBank:",
        JSON.stringify(
          pagbankData,
          null,
          2
        )
      );

      return res.status(
        pagbankResponse.status
      ).json({
        ok: false,
        error:
          "O PagBank recusou a criação do checkout.",
        detalhes: pagbankData
      });
    }

    // --------------------------------------------------
    // ID do checkout
    // --------------------------------------------------

    const pagbankCheckoutId =
      pagbankData.id || null;

    // --------------------------------------------------
    // Encontrar link PAY
    // --------------------------------------------------

    let payLink = null;

    if (
      Array.isArray(
        pagbankData.links
      )
    ) {
      const pay = pagbankData.links.find(
        link =>
          link.rel === "PAY"
      );

      if (pay) {
        payLink = pay.href;
      }
    }

    // Algumas respostas podem usar outro formato
    if (
      !payLink &&
      pagbankData.links &&
      pagbankData.links.PAY
    ) {
      payLink =
        pagbankData.links.PAY;
    }

    // --------------------------------------------------
    // Verifica se recebeu link
    // --------------------------------------------------

    if (!payLink) {
      console.error(
        "Checkout criado, mas link PAY não encontrado:",
        JSON.stringify(
          pagbankData,
          null,
          2
        )
      );

      return res.status(502).json({
        ok: false,
        error:
          "O PagBank criou o checkout, mas não retornou o link de pagamento.",
        pagbankCheckoutId:
          pagbankCheckoutId
      });
    }

    // --------------------------------------------------
    // Resposta para checkout.html
    // --------------------------------------------------

    console.log(
      "Checkout PagBank criado com sucesso."
    );

    console.log(
      "Checkout ID:",
      pagbankCheckoutId
    );

    console.log(
      "Link de pagamento:",
      payLink
    );

    return res.json({
      ok: true,

      pedidoId:
        pedidoId,

      pagbankCheckoutId:
        pagbankCheckoutId,

      payLink:
        payLink
    });

  } catch (error) {
    console.error(
      "Erro interno em /api/pedidos:",
      error
    );

    return res.status(500).json({
      ok: false,
      error:
        error.message ||
        "Erro interno ao criar o pedido."
    });
  }
});

// ======================================================
// WEBHOOK PAGBANK
// ======================================================

app.post(
  "/api/pagbank/webhook",
  (req, res) => {

    console.log(
      "Notificação recebida do PagBank:"
    );

    console.log(
      JSON.stringify(
        req.body,
        null,
        2
      )
    );

    // Por enquanto apenas confirma recebimento.
    // Depois podemos atualizar o status do pedido
    // no MariaDB automaticamente.

    return res.status(200).json({
      ok: true
    });
  }
);

// ======================================================
// ERROS DE API
// ======================================================

app.use(
  (req, res, next) => {

    if (
      req.path.startsWith("/api/")
    ) {
      return res.status(404).json({
        ok: false,
        error:
          "Rota da API não encontrada."
      });
    }

    next();
  }
);

// ======================================================
// ERRO GERAL
// ======================================================

app.use(
  (err, req, res, next) => {

    console.error(
      "Erro geral:",
      err
    );

    if (
      req.path.startsWith("/api/")
    ) {
      return res.status(500).json({
        ok: false,
        error:
          "Erro interno do servidor."
      });
    }

    res.status(500).send(
      "Erro interno do servidor."
    );
  }
);

// ======================================================
// INICIAR SERVIDOR
// ======================================================

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `Servidor LUXOR funcionando na porta ${PORT}`
    );

    console.log(
      `PagBank: ${PAGBANK_ENV}`
    );

    console.log(
      `URL pública: ${PUBLIC_URL}`
    );
  }
);
