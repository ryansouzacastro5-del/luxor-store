const express = require("express");
const path = require("path");
const mysql = require("mysql2/promise");
require("dotenv").config();

const app = express();

const PORT = process.env.PORT || 10000;

const PUBLIC_URL =
  process.env.PUBLIC_URL ||
  "https://luxor-store-1.onrender.com";

const PAGBANK_ENV =
  (process.env.PAGBANK_ENV || "sandbox").toLowerCase();

const PAGBANK_TOKEN =
  process.env.PAGBANK_TOKEN;

const PAGBANK_API =
  PAGBANK_ENV === "production"
    ? "https://api.pagseguro.com"
    : "https://sandbox.api.pagseguro.com";

/* =========================================================
   BANCO DE DADOS
========================================================= */

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || "lojadereilogio",

  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,

  ssl:
    process.env.DB_SSL === "false"
      ? undefined
      : {
          rejectUnauthorized: false
        }
});


/* =========================================================
   MIDDLEWARE
========================================================= */

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(__dirname));


/* =========================================================
   PÁGINAS
========================================================= */

app.get("/", (req, res) => {
  res.sendFile(
    path.join(__dirname, "index.html")
  );
});


app.get("/checkout.html", (req, res) => {
  res.sendFile(
    path.join(__dirname, "checkout.html")
  );
});


app.get("/admin.html", (req, res) => {
  res.sendFile(
    path.join(__dirname, "admin.html")
  );
});


app.get("/pagamento-retorno.html", (req, res) => {
  res.sendFile(
    path.join(__dirname, "pagamento-retorno.html")
  );
});


/* =========================================================
   TESTE DO SERVIDOR
========================================================= */

app.get("/api", async (req, res) => {

  let banco = false;

  try {

    await pool.query("SELECT 1");

    banco = true;

  } catch (error) {

    console.error(
      "Erro ao testar banco:",
      error.message
    );

  }

  res.json({
    ok: true,
    servidor: "LUXOR",
    banco: banco,
    pagbank: PAGBANK_ENV
  });

});


/* =========================================================
   TESTE DO BANCO
========================================================= */

app.get("/api/banco", async (req, res) => {

  try {

    const [rows] =
      await pool.query(
        "SELECT NOW() AS data"
      );

    res.json({
      ok: true,
      banco: "conectado",
      data: rows[0].data
    });

  } catch (error) {

    console.error(
      "Erro MariaDB:",
      error
    );

    res.status(500).json({
      ok: false,
      error:
        "Não foi possível conectar ao MariaDB.",
      detalhes:
        error.message
    });

  }

});


/* =========================================================
   CRIAR PEDIDO
========================================================= */

app.post(
  "/api/pedidos",
  async (req, res) => {

    let connection = null;

    try {

      if (!PAGBANK_TOKEN) {

        return res.status(500).json({
          ok: false,
          error:
            "PAGBANK_TOKEN não configurado no Render."
        });

      }


      const {
        cliente,
        produto
      } = req.body;


      if (!cliente) {

        return res.status(400).json({
          ok: false,
          error:
            "Dados do cliente não foram enviados."
        });

      }


      if (!produto) {

        return res.status(400).json({
          ok: false,
          error:
            "Produto não foi enviado."
        });

      }


      /* =========================
         CLIENTE
      ========================= */

      const nome =
        String(
          cliente.nome || ""
        ).trim();

      const email =
        String(
          cliente.email || ""
        ).trim();

      const telefone =
        String(
          cliente.telefone || ""
        ).replace(/\D/g, "");

      const cpf =
        String(
          cliente.cpf || ""
        ).replace(/\D/g, "");

      const cep =
        String(
          cliente.cep || ""
        ).trim();

      const estado =
        String(
          cliente.estado || ""
        ).trim();

      const endereco =
        String(
          cliente.endereco || ""
        ).trim();

      const numero =
        String(
          cliente.numero || ""
        ).trim();

      const complemento =
        String(
          cliente.complemento || ""
        ).trim();

      const cidade =
        String(
          cliente.cidade || ""
        ).trim();


      /* =========================
         PRODUTO
      ========================= */

      const produtoId =
        Number(produto.id || 0);

      const produtoNome =
        String(
          produto.nome ||
          "Relógio Premium importado"
        ).trim();

      const preco =
        Number(produto.preco);


      if (!nome) {

        return res.status(400).json({
          ok: false,
          error:
            "Informe o nome completo."
        });

      }


      if (!email) {

        return res.status(400).json({
          ok: false,
          error:
            "Informe o e-mail."
        });

      }


      if (!Number.isFinite(preco) || preco <= 0) {

        return res.status(400).json({
          ok: false,
          error:
            "Valor do produto inválido."
        });

      }


      /* =========================
         REFERÊNCIA DO PEDIDO
      ========================= */

      const referencia =
        "LUXOR-" +
        Date.now() +
        "-" +
        Math.floor(
          Math.random() * 10000
        );


      /* =========================
         CONEXÃO COM BANCO
      ========================= */

      connection =
        await pool.getConnection();


      /* =========================
         SALVA PEDIDO PRIMEIRO
      ========================= */

      const [resultado] =
        await connection.execute(

          `
          INSERT INTO pedidos
          (
            produto_id,
            produto_nome,
            quantidade,
            valor,

            nome,
            email,
            telefone,
            cpf,

            cep,
            endereco,
            numero,
            complemento,
            cidade,
            estado,

            status,
            payment_status,

            pagbank_reference_id
          )

          VALUES
          (
            ?,
            ?,
            1,
            ?,

            ?,
            ?,
            ?,
            ?,

            ?,
            ?,
            ?,
            ?,
            ?,
            ?,

            'AGUARDANDO_PAGAMENTO',
            'PENDING',

            ?
          )
          `,

          [
            produtoId,
            produtoNome,
            preco,

            nome,
            email,
            telefone || null,
            cpf || null,

            cep || null,
            endereco || null,
            numero || null,
            complemento || null,
            cidade || null,
            estado || null,

            referencia
          ]

        );


      const pedidoId =
        resultado.insertId;


      /* =====================================================
         CUSTOMER PAGBANK
      ===================================================== */

      const customer = {

        name: nome,

        email: email

      };


      if (
        cpf.length === 11 ||
        cpf.length === 14
      ) {

        customer.tax_id = cpf;

      }


      /* =========================
         TELEFONE
      ========================= */

      if (
        telefone.length >= 10
      ) {

        let telefonePagBank =
          telefone;

        if (
          telefonePagBank.startsWith("55")
        ) {

          telefonePagBank =
            telefonePagBank.substring(2);

        }


        const area =
          telefonePagBank.substring(
            0,
            2
          );

        const numeroTelefone =
          telefonePagBank.substring(
            2
          );


        if (
          area.length === 2 &&
          numeroTelefone.length >= 8
        ) {

          customer.phone = {

            country: "+55",

            area: area,

            number:
              numeroTelefone

          };

        }

      }


      /* =====================================================
         CHECKOUT PAGBANK
      ===================================================== */

      const valorCentavos =
        Math.round(
          preco * 100
        );


      const checkoutBody = {

        reference_id:
          referencia,


        customer:
          customer,


        customer_modifiable:
          true,


        items: [

          {

            reference_id:
              String(
                produtoId || 1
              ),

            name:
              produtoNome,

            quantity:
              1,

            unit_amount:
              valorCentavos

          }

        ],


        payment_methods: [

          {
            type:
              "CREDIT_CARD"
          },

          {
            type:
              "PIX"
          },

          {
            type:
              "BOLETO"
          }

        ],


        redirect_url:
          PUBLIC_URL +
          "/pagamento-retorno.html",


        return_url:
          PUBLIC_URL +
          "/index.html",


        notification_urls: [

          PUBLIC_URL +
          "/api/pagbank/webhook"

        ],


        payment_notification_urls: [

          PUBLIC_URL +
          "/api/pagbank/webhook"

        ]

      };


      console.log(
        "================================"
      );

      console.log(
        "CRIANDO CHECKOUT PAGBANK"
      );

      console.log(
        "Pedido:",
        pedidoId
      );

      console.log(
        "Referência:",
        referencia
      );

      console.log(
        "Produto:",
        produtoNome
      );

      console.log(
        "Valor:",
        preco
      );

      console.log(
        "================================"
      );


      /* =====================================================
         CHAMADA PAGBANK
      ===================================================== */

      const pagbankResponse =
        await fetch(

          PAGBANK_API +
          "/checkouts",

          {

            method:
              "POST",

            headers: {

              "Authorization":
                "Bearer " +
                PAGBANK_TOKEN,

              "Content-Type":
                "application/json",

              "Accept":
                "application/json"

            },

            body:
              JSON.stringify(
                checkoutBody
              )

          }

        );


      const respostaTexto =
        await pagbankResponse.text();


      let pagbankData;


      try {

        pagbankData =
          JSON.parse(
            respostaTexto
          );

      } catch {

        console.error(
          "Resposta inválida do PagBank:",
          respostaTexto
        );


        return res.status(502).json({

          ok: false,

          error:
            "O PagBank retornou uma resposta inválida.",

          detalhes:
            respostaTexto.substring(
              0,
              500
            )

        });

      }


      /* =====================================================
         ERRO PAGBANK
      ===================================================== */

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

          detalhes:
            pagbankData,

          pedidoId:
            pedidoId

        });

      }


      /* =====================================================
         PEGAR ID DO CHECKOUT
      ===================================================== */

      const pagbankCheckoutId =
        pagbankData.id ||
        null;


      /* =====================================================
         PEGAR LINK DE PAGAMENTO
      ===================================================== */

      let payLink =
        null;


      if (
        Array.isArray(
          pagbankData.links
        )
      ) {

        const pay =
          pagbankData.links.find(
            link =>
              link.rel === "PAY"
          );


        if (pay) {

          payLink =
            pay.href;

        }

      }


      if (!payLink) {

        console.error(
          "Link PAY não encontrado."
        );


        return res.status(502).json({

          ok: false,

          error:
            "O PagBank criou o checkout, mas não retornou o link de pagamento.",

          pedidoId:
            pedidoId,

          pagbankCheckoutId:
            pagbankCheckoutId

        });

      }


      /* =====================================================
         ATUALIZAR PEDIDO COM CHECKOUT
      ===================================================== */

      await connection.execute(

        `
        UPDATE pedidos

        SET
          pagbank_checkout_id = ?,
          status = 'AGUARDANDO_PAGAMENTO'

        WHERE id = ?
        `,

        [
          pagbankCheckoutId,
          pedidoId
        ]

      );


      /* =====================================================
         RESPOSTA PARA CHECKOUT.HTML
      ===================================================== */

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
        "ERRO /api/pedidos:",
        error
      );


      return res.status(500).json({

        ok: false,

        error:
          error.message ||
          "Erro interno ao criar pedido."

      });


    } finally {

      if (connection) {

        connection.release();

      }

    }

  }
);


/* =========================================================
   WEBHOOK PAGBANK
========================================================= */

app.post(
  "/api/pagbank/webhook",
  async (req, res) => {

    let connection = null;

    try {

      console.log(
        "================================"
      );

      console.log(
        "WEBHOOK PAGBANK RECEBIDO"
      );

      console.log(
        JSON.stringify(
          req.body,
          null,
          2
        )
      );

      console.log(
        "================================"
      );


      const dados =
        req.body || {};


      /* =====================================================
         IDENTIFICAR REFERÊNCIA
      ===================================================== */

      const referencia =
        dados.reference_id ||
        dados.order?.reference_id ||
        dados.checkout?.reference_id ||
        null;


      /* =====================================================
         IDENTIFICAR ID PAGBANK
      ===================================================== */

      const checkoutId =
        dados.id ||
        dados.checkout?.id ||
        null;


      /* =====================================================
         STATUS
      ===================================================== */

      let statusPagamento =
        dados.status ||
        dados.payment?.status ||
        dados.charges?.[0]?.status ||
        dados.order?.charges?.[0]?.status ||
        null;


      if (
        statusPagamento
      ) {

        statusPagamento =
          String(
            statusPagamento
          ).toUpperCase();

      }


      /* =====================================================
         SE NÃO VEIO NADA ÚTIL
      ===================================================== */

      if (
        !referencia &&
        !checkoutId
      ) {

        return res.status(200).json({
          ok: true,
          recebido: true
        });

      }


      connection =
        await pool.getConnection();


      /* =====================================================
         BUSCAR PEDIDO
      ===================================================== */

      let rows;


      if (referencia) {

        [rows] =
          await connection.execute(

            `
            SELECT *
            FROM pedidos
            WHERE pagbank_reference_id = ?
            LIMIT 1
            `,

            [
              referencia
            ]

          );

      } else {

        [rows] =
          await connection.execute(

            `
            SELECT *
            FROM pedidos
            WHERE pagbank_checkout_id = ?
            LIMIT 1
            `,

            [
              checkoutId
            ]

          );

      }


      if (
        rows.length === 0
      ) {

        console.log(
          "Pedido não encontrado para webhook."
        );

        return res.status(200).json({
          ok: true
        });

      }


      const pedido =
        rows[0];


      /* =====================================================
         MAPEAR STATUS PAGBANK
      ===================================================== */

      let statusPedido =
        pedido.status;


      if (
        statusPagamento ===
        "PAID"
      ) {

        statusPedido =
          "PAGO";

      }

      else if (
        statusPagamento ===
        "AUTHORIZED"
      ) {

        statusPedido =
          "AUTORIZADO";

      }

      else if (
        statusPagamento ===
        "IN_ANALYSIS"
      ) {

        statusPedido =
          "EM_ANALISE";

      }

      else if (
        statusPagamento ===
        "DECLINED"
      ) {

        statusPedido =
          "RECUSADO";

      }

      else if (
        statusPagamento ===
        "CANCELED"
      ) {

        statusPedido =
          "CANCELADO";

      }

      else if (
        statusPagamento ===
        "WAITING"
      ) {

        statusPedido =
          "AGUARDANDO_PAGAMENTO";

      }


      /* =====================================================
         PAYMENT ID
      ===================================================== */

      const paymentId =
        dados.payment_id ||
        dados.payment?.id ||
        dados.charges?.[0]?.id ||
        dados.order?.charges?.[0]?.id ||
        null;


      /* =====================================================
         ATUALIZAR BANCO
      ===================================================== */

      await connection.execute(

        `
        UPDATE pedidos

        SET

          status = ?,

          payment_status = ?,

          pagbank_payment_id =
            COALESCE(?, pagbank_payment_id)

        WHERE id = ?

        `,

        [

          statusPedido,

          statusPagamento ||
            pedido.payment_status,

          paymentId,

          pedido.id

        ]

      );


      console.log(
        "Pedido atualizado:",
        pedido.id
      );

      console.log(
        "Status:",
        statusPedido
      );

      console.log(
        "Pagamento:",
        statusPagamento
      );


      return res.status(200).json({

        ok: true

      });


    } catch (error) {

      console.error(
        "Erro no webhook:",
        error
      );


      /*
       * Retornamos 200 para evitar
       * que o PagBank fique repetindo
       * imediatamente uma notificação
       * causada por erro interno.
       */

      return res.status(200).json({

        ok: false,

        error:
          "Webhook recebido."

      });


    } finally {

      if (connection) {

        connection.release();

      }

    }

  }
);


/* =========================================================
   LISTAR PEDIDOS PARA ADMIN
========================================================= */

app.get(
  "/api/admin/pedidos",
  async (req, res) => {

    try {

      const [pedidos] =
        await pool.query(

          `
          SELECT

            id AS pedido,

            criado_em AS data_compra,

            produto_id,

            produto_nome AS produto,

            quantidade,

            valor,

            nome AS cliente,

            email,

            telefone,

            cpf,

            cep,

            endereco,

            numero,

            complemento,

            cidade,

            estado,

            status,

            payment_status,

            pagbank_checkout_id,

            pagbank_reference_id,

            pagbank_payment_id,

            atualizado_em

          FROM pedidos

          ORDER BY id DESC

          `

        );


      res.json({

        ok: true,

        pedidos:
          pedidos

      });


    } catch (error) {

      console.error(
        "Erro ao listar pedidos:",
        error
      );


      res.status(500).json({

        ok: false,

        error:
          "Não foi possível carregar os pedidos."

      });

    }

  }
);


/* =========================================================
   BUSCAR PEDIDO
========================================================= */

app.get(
  "/api/admin/pedidos/:id",
  async (req, res) => {

    try {

      const id =
        Number(req.params.id);


      if (!Number.isInteger(id)) {

        return res.status(400).json({

          ok: false,

          error:
            "ID de pedido inválido."

        });

      }


      const [rows] =
        await pool.execute(

          `
          SELECT *

          FROM pedidos

          WHERE id = ?

          LIMIT 1
          `,

          [
            id
          ]

        );


      if (
        rows.length === 0
      ) {

        return res.status(404).json({

          ok: false,

          error:
            "Pedido não encontrado."

        });

      }


      res.json({

        ok: true,

        pedido:
          rows[0]

      });


    } catch (error) {

      console.error(
        error
      );


      res.status(500).json({

        ok: false,

        error:
          "Erro ao consultar pedido."

      });

    }

  }
);


/* =========================================================
   ROTA DE API NÃO ENCONTRADA
========================================================= */

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


/* =========================================================
   ERRO GERAL
========================================================= */

app.use(
  (
    err,
    req,
    res,
    next
  ) => {

    console.error(
      "ERRO GERAL:",
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


/* =========================================================
   INICIAR
========================================================= */

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      "================================"
    );

    console.log(
      "LUXOR ONLINE"
    );

    console.log(
      "Porta:",
      PORT
    );

    console.log(
      "PagBank:",
      PAGBANK_ENV
    );

    console.log(
      "URL:",
      PUBLIC_URL
    );

    console.log(
      "Banco:",
      process.env.DB_NAME ||
        "lojadereilogio"
    );

    console.log(
      "================================"
    );

  }
);
