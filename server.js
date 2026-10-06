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
  process.env.PAGBANK_ENV || "sandbox";

const PAGBANK_TOKEN =
  process.env.PAGBANK_TOKEN || "";

const PAGBANK_API =
  PAGBANK_ENV === "production"
    ? "https://api.pagseguro.com"
    : "https://sandbox.api.pagseguro.com";

// =====================================================
// BANCO DE DADOS
// =====================================================

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

// =====================================================
// MIDDLEWARE
// =====================================================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(__dirname));

// =====================================================
// PÁGINAS
// =====================================================

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
  res.sendFile(
    path.join(__dirname, "pagamento-retorno.html")
  );
});

app.get("/painel/admin", (req, res) => {
  res.sendFile(
    path.join(__dirname, "admin.html")
  );
});

// =====================================================
// TESTE DA API
// =====================================================

app.get("/api", async (req, res) => {
  let banco = false;

  try {
    const connection =
      await pool.getConnection();

    await connection.query(
      "SELECT 1"
    );

    connection.release();

    banco = true;

  } catch (error) {

    console.error(
      "Erro no banco:",
      error.message
    );
  }

  res.json({
    ok: true,
    servidor: "LUXOR",
    banco,
    pagbank: PAGBANK_ENV
  });
});

// =====================================================
// TESTE DO BANCO
// =====================================================

app.get("/api/banco", async (req, res) => {
  try {

    const [rows] =
      await pool.query(
        "SELECT 1 AS conectado"
      );

    res.json({
      ok: true,
      banco: rows[0]
    });

  } catch (error) {

    console.error(
      "Erro no banco:",
      error
    );

    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// =====================================================
// PRODUTOS
// =====================================================

app.get("/api/produtos", async (req, res) => {
  try {

    const [rows] =
      await pool.query(`
        SELECT
          id,
          nome,
          descricao,
          preco,
          estoque,
          imagem
        FROM produtos
        ORDER BY id ASC
      `);

    res.json(rows);

  } catch (error) {

    console.error(
      "Erro ao buscar produtos:",
      error
    );

    res.status(500).json({
      ok: false,
      error:
        "Erro ao buscar produtos."
    });
  }
});

// =====================================================
// CRIAR PEDIDO + CHECKOUT PAGBANK
// CARTÃO + PIX + BOLETO
// =====================================================

app.post("/api/pedidos", async (req, res) => {

  try {

    const {
      cliente,
      produto
    } = req.body;

    // -------------------------------------------------
    // VALIDAR CLIENTE
    // -------------------------------------------------

    if (!cliente) {

      return res.status(400).json({
        ok: false,
        error:
          "Dados do cliente não informados."
      });
    }

    // -------------------------------------------------
    // VALIDAR PRODUTO
    // -------------------------------------------------

    if (!produto) {

      return res.status(400).json({
        ok: false,
        error:
          "Produto não informado."
      });
    }

    // -------------------------------------------------
    // DADOS DO CLIENTE
    // -------------------------------------------------

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
      ).trim();

    const cpf =
      String(
        cliente.cpf || ""
      ).trim();

    const cep =
      String(
        cliente.cep || ""
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

    const estado =
      String(
        cliente.estado || ""
      ).trim();

    // -------------------------------------------------
    // DADOS DO PRODUTO
    // -------------------------------------------------

    const produtoId =
      Number(
        produto.id || 0
      );

    const produtoNome =
      String(
        produto.nome ||
        "Relógio Premium importado"
      ).trim();

    const preco =
      Number(
        produto.preco
      );

    // -------------------------------------------------
    // VALIDAÇÕES
    // -------------------------------------------------

    if (!nome) {

      return res.status(400).json({
        ok: false,
        error:
          "Nome é obrigatório."
      });
    }

    if (!email) {

      return res.status(400).json({
        ok: false,
        error:
          "E-mail é obrigatório."
      });
    }

    if (
      !Number.isFinite(preco) ||
      preco <= 0
    ) {

      return res.status(400).json({
        ok: false,
        error:
          "Valor do produto inválido."
      });
    }

    // -------------------------------------------------
    // REFERÊNCIA ÚNICA
    // -------------------------------------------------

    const referencia =
      "LUXOR-" +
      Date.now() +
      "-" +
      Math.floor(
        Math.random() * 100000
      );

    // -------------------------------------------------
    // SALVAR PEDIDO NO BANCO
    // -------------------------------------------------

    const [resultado] =
      await pool.query(
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
          telefone,
          cpf,

          cep,
          endereco,
          numero,
          complemento,
          cidade,
          estado,

          referencia
        ]
      );

    const pedidoId =
      resultado.insertId;

    console.log(
      "Pedido criado no banco:",
      pedidoId
    );

    console.log(
      "Referência:",
      referencia
    );

    // -------------------------------------------------
    // VERIFICAR TOKEN PAGBANK
    // -------------------------------------------------

    if (!PAGBANK_TOKEN) {

      console.error(
        "PAGBANK_TOKEN não configurado."
      );

      return res.status(500).json({
        ok: false,
        error:
          "PAGBANK_TOKEN não configurado."
      });
    }

    // -------------------------------------------------
    // VALOR EM CENTAVOS
    // -------------------------------------------------

    const valorCentavos =
      Math.round(
        preco * 100
      );

    // -------------------------------------------------
    // CPF SOMENTE NÚMEROS
    // -------------------------------------------------

    const cpfNumeros =
      cpf.replace(
        /\D/g,
        ""
      );

    // -------------------------------------------------
    // CUSTOMER PAGBANK
    // -------------------------------------------------

    const customer = {
      name: nome,
      email: email
    };

    if (cpfNumeros) {
      customer.tax_id =
        cpfNumeros;
    }

    // -------------------------------------------------
    // CHECKOUT PAGBANK
    //
    // CARTÃO
    // PIX
    // BOLETO
    // -------------------------------------------------

    const checkoutPayload = {

      reference_id:
        referencia,

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

      redirect_waiting_time:
        5,

      return_url:
        PUBLIC_URL +
        "/index.html",

      // Notificação de alterações
      // do checkout
      notification_urls: [
        PUBLIC_URL +
        "/api/pagbank/webhook"
      ],

      // Notificação de alterações
      // do pagamento
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
      "Valor:",
      preco
    );

    console.log(
      "Métodos:",
      "CREDIT_CARD + PIX + BOLETO"
    );

    console.log(
      "================================"
    );

    // -------------------------------------------------
    // CRIAR CHECKOUT
    // -------------------------------------------------

    const respostaPagBank =
      await fetch(
        PAGBANK_API +
        "/checkouts",
        {
          method: "POST",

          headers: {
            Authorization:
              "Bearer " +
              PAGBANK_TOKEN,

            "Content-Type":
              "application/json",

            Accept:
              "application/json"
          },

          body:
            JSON.stringify(
              checkoutPayload
            )
        }
      );

    // -------------------------------------------------
    // LER RESPOSTA
    // -------------------------------------------------

    const textoPagBank =
      await respostaPagBank.text();

    let dadosPagBank;

    try {

      dadosPagBank =
        textoPagBank
          ? JSON.parse(
              textoPagBank
            )
          : {};

    } catch (erro) {

      console.error(
        "Resposta inválida do PagBank:",
        textoPagBank
      );

      dadosPagBank = {
        raw:
          textoPagBank
      };
    }

    // -------------------------------------------------
    // ERRO PAGBANK
    // -------------------------------------------------

    if (
      !respostaPagBank.ok
    ) {

      console.error(
        "================================"
      );

      console.error(
        "ERRO PAGBANK"
      );

      console.error(
        "HTTP:",
        respostaPagBank.status
      );

      console.error(
        dadosPagBank
      );

      console.error(
        "================================"
      );

      return res.status(502).json({
        ok: false,

        error:
          "Erro ao criar pagamento no PagBank.",

        detalhe:
          dadosPagBank
      });
    }

    // -------------------------------------------------
    // ENCONTRAR LINK PAY
    // -------------------------------------------------

    let payLink = null;

    if (
      Array.isArray(
        dadosPagBank.links
      )
    ) {

      const link =
        dadosPagBank.links.find(
          item => {

            const rel =
              String(
                item.rel || ""
              ).toUpperCase();

            return (
              rel === "PAY"
            );
          }
        );

      if (link) {

        payLink =
          link.href ||
          null;
      }
    }

    // -------------------------------------------------
    // OUTROS FORMATOS DE LINK
    // -------------------------------------------------

    if (!payLink) {

      payLink =
        dadosPagBank.payment_link ||
        dadosPagBank.pay_link ||
        null;
    }

    // -------------------------------------------------
    // ID CHECKOUT
    // -------------------------------------------------

    const pagbankCheckoutId =
      dadosPagBank.id ||
      null;

    // -------------------------------------------------
    // ATUALIZAR PEDIDO COM CHECKOUT
    // -------------------------------------------------

    await pool.query(
      `
      UPDATE pedidos

      SET
        pagbank_checkout_id = ?,
        payment_status = 'PENDING',
        status = 'AGUARDANDO_PAGAMENTO'

      WHERE id = ?
      `,
      [
        pagbankCheckoutId,
        pedidoId
      ]
    );

    console.log(
      "Checkout criado:",
      pagbankCheckoutId
    );

    console.log(
      "Link de pagamento:",
      payLink
    );

    // -------------------------------------------------
    // RESPOSTA PARA O FRONTEND
    // -------------------------------------------------

    return res.json({

      ok: true,

      pedidoId,

      referencia,

      pagbankCheckoutId,

      payLink

    });

  } catch (error) {

    console.error(
      "================================"
    );

    console.error(
      "ERRO AO CRIAR PEDIDO"
    );

    console.error(
      error
    );

    console.error(
      "================================"
    );

    return res.status(500).json({
      ok: false,

      error:
        error.message ||
        "Erro interno do servidor."
    });
  }
});

// =====================================================
// CONSULTAR PEDIDO DO CLIENTE
// NOME + CPF
// =====================================================

app.get(
  "/api/pedidos/cliente",
  async (req, res) => {

    try {

      const nome =
        String(
          req.query.nome || ""
        ).trim();

      const cpf =
        String(
          req.query.cpf || ""
        ).replace(
          /\D/g,
          ""
        );

      // -------------------------------------------------
      // VALIDAÇÃO
      // -------------------------------------------------

      if (!nome || !cpf) {

        return res.status(400).json({
          ok: false,
          error:
            "Nome e CPF são obrigatórios."
        });
      }

      if (cpf.length !== 11) {

        return res.status(400).json({
          ok: false,
          error:
            "CPF inválido."
        });
      }

      // -------------------------------------------------
      // CONSULTAR
      // -------------------------------------------------

      const [rows] =
        await pool.query(
          `
          SELECT

            id,

            criado_em,

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

            produto_nome,
            quantidade,
            valor,

            status,
            payment_status

          FROM pedidos

          WHERE

            REPLACE(
              REPLACE(
                REPLACE(
                  cpf,
                  '.',
                  ''
                ),
                '-',
                ''
              ),
              ' ',
              ''
            ) = ?

            AND LOWER(
              TRIM(nome)
            )
            =
            LOWER(
              TRIM(?)
            )

          ORDER BY
            criado_em DESC
          `,
          [
            cpf,
            nome
          ]
        );

      // -------------------------------------------------
      // NÃO ENCONTRADO
      // -------------------------------------------------

      if (!rows.length) {

        return res.status(404).json({
          ok: false,

          error:
            "Nenhum pedido encontrado para este nome e CPF."
        });
      }

      // -------------------------------------------------
      // FORMATAR
      // -------------------------------------------------

      const pedidos =
        rows.map(
          pedido => ({

            id:
              pedido.id,

            criado_em:
              pedido.criado_em,

            nome:
              pedido.nome,

            email:
              pedido.email,

            telefone:
              pedido.telefone,

            cpf:
              pedido.cpf,

            cep:
              pedido.cep,

            endereco:
              pedido.endereco,

            numero:
              pedido.numero,

            complemento:
              pedido.complemento,

            cidade:
              pedido.cidade,

            estado:
              pedido.estado,

            produto_nome:
              pedido.produto_nome,

            quantidade:
              Number(
                pedido.quantidade || 1
              ),

            valor:
              Number(
                pedido.valor || 0
              ),

            status:
              pedido.status,

            payment_status:
              pedido.payment_status
          })
        );

      return res.json({
        ok: true,
        pedidos
      });

    } catch (error) {

      console.error(
        "Erro ao consultar pedido:",
        error
      );

      return res.status(500).json({
        ok: false,
        error:
          "Erro ao consultar pedido."
      });
    }
  }
);

// =====================================================
// RESUMO DO ADMIN
// =====================================================

app.get(
  "/api/admin/resumo",
  async (req, res) => {

    try {

      const [rows] =
        await pool.query(
          `
          SELECT

            COUNT(*) AS quantidade,

            COALESCE(
              SUM(valor),
              0
            ) AS total,

            COUNT(
              DISTINCT email
            ) AS clientes,

            MAX(criado_em)
              AS ultima

          FROM pedidos

          WHERE

            payment_status = 'PAID'

            OR status IN (
              'PAGO',
              'PAID',
              'APROVADO',
              'APPROVED'
            )
          `
        );

      return res.json({

        quantidade:
          Number(
            rows[0].quantidade || 0
          ),

        total:
          Number(
            rows[0].total || 0
          ),

        clientes:
          Number(
            rows[0].clientes || 0
          ),

        ultima:
          rows[0].ultima || null

      });

    } catch (error) {

      console.error(
        "Erro no resumo:",
        error
      );

      return res.status(500).json({
        ok: false,
        error:
          "Erro ao carregar resumo administrativo."
      });
    }
  }
);

// =====================================================
// LISTAR PEDIDOS DO ADMIN
// =====================================================

app.get(
  "/api/admin/pedidos",
  async (req, res) => {

    try {

      const {
        q,
        inicio,
        fim
      } = req.query;

      let sql = `
        SELECT

          id,
          criado_em,

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

          produto_id,
          produto_nome,
          quantidade,
          valor,

          status,
          payment_status,

          pagbank_checkout_id,
          pagbank_reference_id,
          pagbank_payment_id

        FROM pedidos

        WHERE 1 = 1
      `;

      const valores = [];

      // -------------------------------------------------
      // BUSCA
      // -------------------------------------------------

      if (q) {

        sql += `
          AND (

            CAST(id AS CHAR)
              LIKE ?

            OR nome
              LIKE ?

            OR email
              LIKE ?

            OR cpf
              LIKE ?

            OR produto_nome
              LIKE ?
          )
        `;

        const busca =
          "%" +
          q +
          "%";

        valores.push(
          busca,
          busca,
          busca,
          busca,
          busca
        );
      }

      // -------------------------------------------------
      // DATA INICIAL
      // -------------------------------------------------

      if (inicio) {

        sql += `
          AND criado_em >= ?
        `;

        valores.push(
          inicio +
          " 00:00:00"
        );
      }

      // -------------------------------------------------
      // DATA FINAL
      // -------------------------------------------------

      if (fim) {

        sql += `
          AND criado_em <= ?
        `;

        valores.push(
          fim +
          " 23:59:59"
        );
      }

      sql += `
        ORDER BY
          criado_em DESC
      `;

      const [rows] =
        await pool.query(
          sql,
          valores
        );

      return res.json(rows);

    } catch (error) {

      console.error(
        "Erro ao listar pedidos:",
        error
      );

      return res.status(500).json({
        ok: false,
        error:
          "Erro ao listar pedidos."
      });
    }
  }
);

// =====================================================
// DETALHES DO PEDIDO
// =====================================================

app.get(
  "/api/admin/pedidos/:id",
  async (req, res) => {

    try {

      const id =
        Number(
          req.params.id
        );

      if (
        !Number.isInteger(id) ||
        id <= 0
      ) {

        return res.status(400).json({
          ok: false,
          error:
            "ID do pedido inválido."
        });
      }

      const [rows] =
        await pool.query(
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

      if (!rows.length) {

        return res.status(404).json({
          ok: false,
          error:
            "Pedido não encontrado."
        });
      }

      return res.json({
        ok: true,
        pedido: rows[0]
      });

    } catch (error) {

      console.error(
        "Erro ao consultar pedido:",
        error
      );

      return res.status(500).json({
        ok: false,
        error:
          "Erro ao consultar pedido."
      });
    }
  }
);

// =====================================================
// WEBHOOK PAGBANK
// =====================================================
//
// Recebe:
//
// PAID
// WAITING
// IN_ANALYSIS
// DECLINED
// CANCELED
//
// E atualiza automaticamente:
//
// pedidos.status
// pedidos.payment_status
// pedidos.pagbank_payment_id
//
// =====================================================

app.post(
  "/api/pagbank/webhook",
  async (req, res) => {

    try {

      const body =
        req.body || {};

      console.log(
        "================================"
      );

      console.log(
        "WEBHOOK PAGBANK RECEBIDO"
      );

      console.log(
        JSON.stringify(
          body,
          null,
          2
        )
      );

      console.log(
        "================================"
      );

      // -------------------------------------------------
      // HEADERS PAGBANK
      // -------------------------------------------------

      const productId =
        req.headers[
          "x-product-id"
        ] || null;

      const productOrigin =
        req.headers[
          "x-product-origin"
        ] || null;

      console.log(
        "x-product-id:",
        productId
      );

      console.log(
        "x-product-origin:",
        productOrigin
      );

      // -------------------------------------------------
      // REFERENCE ID
      // -------------------------------------------------

      let referenceId =
        body.reference_id ||
        body.referenceId ||
        null;

      // -------------------------------------------------
      // CHECKOUT ID
      // -------------------------------------------------

      let checkoutId =
        null;

      if (
        productId &&
        String(
          productId
        ).startsWith("CHEC_")
      ) {

        checkoutId =
          String(
            productId
          );
      }

      if (!checkoutId) {

        checkoutId =
          body.checkout_id ||
          body.checkoutId ||
          null;
      }

      if (!checkoutId) {

        if (
          body.id &&
          String(
            body.id
          ).startsWith("CHEC_")
        ) {

          checkoutId =
            body.id;
        }
      }

      // -------------------------------------------------
      // CHARGE
      // -------------------------------------------------

      let charge = null;

      if (
        Array.isArray(
          body.charges
        ) &&
        body.charges.length
      ) {

        charge =
          body.charges[0];
      }

      if (
        !charge &&
        body.charge
      ) {

        charge =
          body.charge;
      }

      // -------------------------------------------------
      // STATUS
      // -------------------------------------------------

      let status =
        body.status ||
        null;

      if (
        charge &&
        charge.status
      ) {

        status =
          charge.status;
      }

      if (status) {

        status =
          String(
            status
          ).toUpperCase();
      }

      // -------------------------------------------------
      // PAYMENT ID
      // -------------------------------------------------

      let paymentId =
        null;

      if (charge) {

        paymentId =
          charge.id ||
          null;
      }

      if (!paymentId) {

        paymentId =
          body.payment_id ||
          body.paymentId ||
          null;
      }

      // -------------------------------------------------
      // CHARGE REFERENCE
      // -------------------------------------------------

      if (!referenceId && charge) {

        referenceId =
          charge.reference_id ||
          null;
      }

      console.log(
        "Reference:",
        referenceId
      );

      console.log(
        "Checkout:",
        checkoutId
      );

      console.log(
        "Pagamento:",
        paymentId
      );

      console.log(
        "Status:",
        status
      );

      // -------------------------------------------------
      // LOCALIZAR PEDIDO
      // -------------------------------------------------

      let pedido = null;

      // 1. Pela referência
      if (referenceId) {

        const [rows] =
          await pool.query(
            `
            SELECT *
            FROM pedidos
            WHERE
              pagbank_reference_id = ?
            LIMIT 1
            `,
            [
              referenceId
            ]
          );

        if (rows.length) {

          pedido =
            rows[0];
        }
      }

      // 2. Pelo checkout
      if (
        !pedido &&
        checkoutId
      ) {

        const [rows] =
          await pool.query(
            `
            SELECT *
            FROM pedidos
            WHERE
              pagbank_checkout_id = ?
            LIMIT 1
            `,
            [
              checkoutId
            ]
          );

        if (rows.length) {

          pedido =
            rows[0];
        }
      }

      // -------------------------------------------------
      // SE NÃO ACHOU
      // -------------------------------------------------

      if (!pedido) {

        console.error(
          "Pedido não encontrado para o webhook."
        );

        // Respondemos 200 para não gerar
        // repetição desnecessária da notificação.
        return res.status(200).json({
          ok: true,
          recebido: true,
          pedidoEncontrado: false
        });
      }

      // -------------------------------------------------
      // DEFINIR NOVO STATUS
      // -------------------------------------------------

      let paymentStatus =
        pedido.payment_status ||
        "PENDING";

      let pedidoStatus =
        pedido.status ||
        "AGUARDANDO_PAGAMENTO";

      // -------------------------------------------------
      // PAID
      // -------------------------------------------------

      if (
        status === "PAID"
      ) {

        paymentStatus =
          "PAID";

        pedidoStatus =
          "PAGO";
      }

      // -------------------------------------------------
      // WAITING
      //
      // Boleto aguardando pagamento
      // ou pagamento pendente
      // -------------------------------------------------

      else if (
        status === "WAITING"
      ) {

        paymentStatus =
          "WAITING";

        pedidoStatus =
          "AGUARDANDO_PAGAMENTO";
      }

      // -------------------------------------------------
      // IN_ANALYSIS
      //
      // Cartão em análise
      // -------------------------------------------------

      else if (
        status === "IN_ANALYSIS"
      ) {

        paymentStatus =
          "IN_ANALYSIS";

        pedidoStatus =
          "EM_ANALISE";
      }

      // -------------------------------------------------
      // AUTHORIZED
      //
      // Cartão autorizado
      // -------------------------------------------------

      else if (
        status === "AUTHORIZED"
      ) {

        paymentStatus =
          "AUTHORIZED";

        pedidoStatus =
          "AUTORIZADO";
      }

      // -------------------------------------------------
      // DECLINED
      // -------------------------------------------------

      else if (
        status === "DECLINED"
      ) {

        paymentStatus =
          "DECLINED";

        pedidoStatus =
          "RECUSADO";
      }

      // -------------------------------------------------
      // CANCELED
      // -------------------------------------------------

      else if (
        status === "CANCELED" ||
        status === "CANCELLED"
      ) {

        paymentStatus =
          "CANCELED";

        pedidoStatus =
          "CANCELADO";
      }

      // -------------------------------------------------
      // FAILED
      // -------------------------------------------------

      else if (
        status === "FAILED"
      ) {

        paymentStatus =
          "FAILED";

        pedidoStatus =
          "FALHOU";
      }

      // -------------------------------------------------
      // ATUALIZAR BANCO
      // -------------------------------------------------

      await pool.query(
        `
        UPDATE pedidos

        SET

          status = ?,

          payment_status = ?,

          pagbank_checkout_id =
            COALESCE(
              ?,
              pagbank_checkout_id
            ),

          pagbank_reference_id =
            COALESCE(
              ?,
              pagbank_reference_id
            ),

          pagbank_payment_id =
            COALESCE(
              ?,
              pagbank_payment_id
            )

        WHERE id = ?
        `,
        [
          pedidoStatus,
          paymentStatus,

          checkoutId,
          referenceId,
          paymentId,

          pedido.id
        ]
      );

      console.log(
        "================================"
      );

      console.log(
        "PEDIDO ATUALIZADO"
      );

      console.log(
        "ID:",
        pedido.id
      );

      console.log(
        "Status:",
        pedidoStatus
      );

      console.log(
        "Pagamento:",
        paymentStatus
      );

      console.log(
        "================================"
      );

      // -------------------------------------------------
      // RESPONDER PAGBANK
      // -------------------------------------------------

      return res.status(200).json({
        ok: true,
        recebido: true,
        pedidoEncontrado: true,
        pedidoId: pedido.id,
        status: paymentStatus
      });

    } catch (error) {

      console.error(
        "================================"
      );

      console.error(
        "ERRO NO WEBHOOK PAGBANK"
      );

      console.error(
        error
      );

      console.error(
        "================================"
      );

      return res.status(500).json({
        ok: false,
        error:
          "Erro ao processar webhook."
      });
    }
  }
);

// =====================================================
// ROTA MANUAL PARA CONSULTAR STATUS NO PAGBANK
// =====================================================
//
// Útil caso o webhook demore.
// O servidor consulta o checkout diretamente
// no PagBank e sincroniza o pedido.
//
// =====================================================

app.get(
  "/api/pagbank/sincronizar/:id",
  async (req, res) => {

    try {

      const pedidoId =
        Number(
          req.params.id
        );

      if (
        !Number.isInteger(
          pedidoId
        ) ||
        pedidoId <= 0
      ) {

        return res.status(400).json({
          ok: false,
          error:
            "ID do pedido inválido."
        });
      }

      if (!PAGBANK_TOKEN) {

        return res.status(500).json({
          ok: false,
          error:
            "PAGBANK_TOKEN não configurado."
        });
      }

      // -------------------------------------------------
      // BUSCAR PEDIDO
      // -------------------------------------------------

      const [rows] =
        await pool.query(
          `
          SELECT *
          FROM pedidos
          WHERE id = ?
          LIMIT 1
          `,
          [
            pedidoId
          ]
        );

      if (!rows.length) {

        return res.status(404).json({
          ok: false,
          error:
            "Pedido não encontrado."
        });
      }

      const pedido =
        rows[0];

      if (
        !pedido.pagbank_checkout_id
      ) {

        return res.status(400).json({
          ok: false,
          error:
            "Pedido ainda não possui checkout PagBank."
        });
      }

      // -------------------------------------------------
      // CONSULTAR CHECKOUT
      // -------------------------------------------------

      const resposta =
        await fetch(
          PAGBANK_API +
          "/checkouts/" +
          pedido.pagbank_checkout_id,
          {
            method: "GET",

            headers: {
              Authorization:
                "Bearer " +
                PAGBANK_TOKEN,

              Accept:
                "application/json"
            }
          }
        );

      const dados =
        await resposta.json();

      if (
        !resposta.ok
      ) {

        return res.status(502).json({
          ok: false,
          error:
            "Erro ao consultar checkout no PagBank.",
          detalhe:
            dados
        });
      }

      // -------------------------------------------------
      // ENCONTRAR CHARGE
      // -------------------------------------------------

      let charge = null;

      if (
        Array.isArray(
          dados.charges
        ) &&
        dados.charges.length
      ) {

        charge =
          dados.charges[0];
      }

      let status =
        charge?.status ||
        dados.status ||
        null;

      if (status) {

        status =
          String(
            status
          ).toUpperCase();
      }

      let paymentStatus =
        pedido.payment_status ||
        "PENDING";

      let pedidoStatus =
        pedido.status ||
        "AGUARDANDO_PAGAMENTO";

      // -------------------------------------------------
      // SINCRONIZAR STATUS
      // -------------------------------------------------

      if (
        status === "PAID"
      ) {

        paymentStatus =
          "PAID";

        pedidoStatus =
          "PAGO";
      }

      else if (
        status === "WAITING"
      ) {

        paymentStatus =
          "WAITING";

        pedidoStatus =
          "AGUARDANDO_PAGAMENTO";
      }

      else if (
        status === "IN_ANALYSIS"
      ) {

        paymentStatus =
          "IN_ANALYSIS";

        pedidoStatus =
          "EM_ANALISE";
      }

      else if (
        status === "AUTHORIZED"
      ) {

        paymentStatus =
          "AUTHORIZED";

        pedidoStatus =
          "AUTORIZADO";
      }

      else if (
        status === "DECLINED"
      ) {

        paymentStatus =
          "DECLINED";

        pedidoStatus =
          "RECUSADO";
      }

      else if (
        status === "CANCELED" ||
        status === "CANCELLED"
      ) {

        paymentStatus =
          "CANCELED";

        pedidoStatus =
          "CANCELADO";
      }

      // -------------------------------------------------
      // ATUALIZAR
      // -------------------------------------------------

      await pool.query(
        `
        UPDATE pedidos

        SET
          status = ?,
          payment_status = ?,
          pagbank_payment_id =
            COALESCE(
              ?,
              pagbank_payment_id
            )

        WHERE id = ?
        `,
        [
          pedidoStatus,
          paymentStatus,

          charge?.id ||
            null,

          pedidoId
        ]
      );

      return res.json({

        ok: true,

        pedidoId,

        status:
          paymentStatus,

        pedidoStatus,

        checkout:
          dados
      });

    } catch (error) {

      console.error(
        "Erro ao sincronizar PagBank:",
        error
      );

      return res.status(500).json({
        ok: false,
        error:
          "Erro ao sincronizar pagamento."
      });
    }
  }
);

// =====================================================
// FALLBACK DA API
// =====================================================

app.use(
  (req, res, next) => {

    if (
      req.path.startsWith(
        "/api"
      )
    ) {

      return res.status(404).json({

        ok: false,

        error:
          "Rota da API não encontrada.",

        rota:
          req.method +
          " " +
          req.originalUrl

      });
    }

    next();
  }
);

// =====================================================
// ERRO GERAL
// =====================================================

app.use(
  (
    error,
    req,
    res,
    next
  ) => {

    console.error(
      "Erro geral:",
      error
    );

    res.status(500).json({

      ok: false,

      error:
        "Erro interno do servidor."
    });
  }
);

// =====================================================
// INICIAR SERVIDOR
// =====================================================

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      "================================"
    );

    console.log(
      "LUXOR SERVER INICIADO"
    );

    console.log(
      "Porta:",
      PORT
    );

    console.log(
      "URL:",
      PUBLIC_URL
    );

    console.log(
      "PagBank:",
      PAGBANK_ENV
    );

    console.log(
      "================================"
    );
  }
);
