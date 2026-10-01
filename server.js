const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===============================
// CONEXÃO COM O MARIADB
// ===============================

const db = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || "lojadereilogio",

  ssl: process.env.DB_SSL === "false"
    ? undefined
    : {
        rejectUnauthorized: false
      },

  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// ===============================
// TESTE DO SERVIDOR
// ===============================

app.get("/", (req, res) => {
  res.json({
    ok: true,
    mensagem: "Servidor LUXOR funcionando."
  });
});

// ===============================
// TESTE DO BANCO
// ===============================

app.get("/api/status", async (req, res) => {
  try {
    const [resultado] = await db.query("SELECT 1 AS conectado");

    res.json({
      ok: resultado[0].conectado === 1,
      banco: "MariaDB conectado"
    });

  } catch (erro) {
    console.error(erro);

    res.status(500).json({
      ok: false,
      erro: "Não foi possível conectar ao MariaDB."
    });
  }
});

// ===============================
// LISTAR PRODUTOS
// ===============================

app.get("/api/produtos", async (req, res) => {
  try {

    const [produtos] = await db.query(`
      SELECT
        id,
        nome,
        descricao,
        preco,
        estoque,
        imagem,
        categoria,
        destaque,
        criado_em
      FROM produtos
      ORDER BY id ASC
    `);

    const resultado = produtos.map(produto => ({

      id: produto.id,

      produto_id: produto.id,

      nome: produto.nome,

      descricao: produto.descricao || "",

      preco: Number(produto.preco),

      estoque: produto.estoque,

      imagem: produto.imagem || "",

      imagens: produto.imagem
        ? produto.imagem
            .split(",")
            .map(imagem => imagem.trim())
            .filter(Boolean)
        : [],

      categoria: produto.categoria,

      destaque: produto.destaque

    }));

    res.json(resultado);

  } catch (erro) {

    console.error(erro);

    res.status(500).json({
      erro: "Erro ao buscar produtos."
    });
  }
});

// ===============================
// CADASTRAR CLIENTE
// ===============================

app.post("/api/clientes", async (req, res) => {

  try {

    const nome = String(req.body.nome || "").trim();

    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();

    const telefone = String(req.body.telefone || "").trim();

    const cpf = String(req.body.cpf || "").trim();

    const senha = String(req.body.senha || "");

    if (!nome || !email || !telefone || !cpf || !senha) {

      return res.status(400).json({
        erro: "Preencha nome, e-mail, telefone, CPF e senha."
      });

    }

    if (senha.length < 6) {

      return res.status(400).json({
        erro: "A senha deve ter pelo menos 6 caracteres."
      });

    }

    const senhaHash = await bcrypt.hash(senha, 12);

    const [resultado] = await db.execute(
      `
      INSERT INTO clientes
      (
        nome,
        email,
        telefone,
        cpf,
        senha
      )
      VALUES (?, ?, ?, ?, ?)
      `,
      [
        nome,
        email,
        telefone,
        cpf,
        senhaHash
      ]
    );

    res.status(201).json({

      ok: true,

      cliente_id: resultado.insertId,

      mensagem: "Cliente cadastrado com sucesso."

    });

  } catch (erro) {

    console.error(erro);

    if (erro.code === "ER_DUP_ENTRY") {

      return res.status(409).json({
        erro: "Este e-mail já está cadastrado."
      });

    }

    res.status(500).json({
      erro: "Erro ao cadastrar cliente."
    });
  }
});

// ===============================
// CRIAR PEDIDO
// ===============================

app.post("/api/pedidos", async (req, res) => {

  const conexao = await db.getConnection();

  try {

    const nome = String(req.body.nome || "").trim();

    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();

    const telefone = String(req.body.telefone || "").trim();

    const cpf = String(req.body.cpf || "").trim();

    const produtoId = Number(req.body.produto_id);

    const quantidade = Number(req.body.quantidade || 1);

    // -------------------------------
    // VALIDAÇÕES
    // -------------------------------

    if (!nome || !email || !telefone || !cpf) {

      return res.status(400).json({
        erro: "Nome, e-mail, telefone e CPF são obrigatórios."
      });

    }

    if (!Number.isInteger(produtoId) || produtoId <= 0) {

      return res.status(400).json({
        erro: "produto_id inválido."
      });

    }

    if (!Number.isInteger(quantidade) || quantidade <= 0) {

      return res.status(400).json({
        erro: "Quantidade inválida."
      });

    }

    // -------------------------------
    // INICIAR TRANSAÇÃO
    // -------------------------------

    await conexao.beginTransaction();

    // -------------------------------
    // BUSCAR PRODUTO
    // -------------------------------

    const [produtos] = await conexao.execute(
      `
      SELECT
        id,
        nome,
        preco,
        estoque
      FROM produtos
      WHERE id = ?
      LIMIT 1
      FOR UPDATE
      `,
      [produtoId]
    );

    if (produtos.length === 0) {

      await conexao.rollback();

      return res.status(404).json({
        erro: "Produto não encontrado."
      });

    }

    const produto = produtos[0];

    // -------------------------------
    // VERIFICAR ESTOQUE
    // -------------------------------

    if (Number(produto.estoque) < quantidade) {

      await conexao.rollback();

      return res.status(400).json({
        erro: "Estoque insuficiente."
      });

    }

    // -------------------------------
    // PROCURAR CLIENTE
    // -------------------------------

    const [clientes] = await conexao.execute(
      `
      SELECT id
      FROM clientes
      WHERE email = ?
      LIMIT 1
      `,
      [email]
    );

    let clienteId;

    // -------------------------------
    // CLIENTE EXISTENTE
    // -------------------------------

    if (clientes.length > 0) {

      clienteId = clientes[0].id;

      await conexao.execute(
        `
        UPDATE clientes

        SET
          nome = ?,
          telefone = ?,
          cpf = ?

        WHERE id = ?
        `,
        [
          nome,
          telefone,
          cpf,
          clienteId
        ]
      );

    }

    // -------------------------------
    // NOVO CLIENTE
    // -------------------------------

    else {

      const senhaAutomatica = await bcrypt.hash(
        `${Date.now()}-${cpf}`,
        12
      );

      const [novoCliente] = await conexao.execute(
        `
        INSERT INTO clientes
        (
          nome,
          email,
          telefone,
          cpf,
          senha
        )
        VALUES (?, ?, ?, ?, ?)
        `,
        [
          nome,
          email,
          telefone,
          cpf,
          senhaAutomatica
        ]
      );

      clienteId = novoCliente.insertId;
    }

    // -------------------------------
    // CALCULAR VALORES
    // -------------------------------

    const valorUnitario = Number(produto.preco);

    const valorTotal = Number(
      (valorUnitario * quantidade).toFixed(2)
    );

    // -------------------------------
    // CRIAR PEDIDO
    // -------------------------------

    const [pedido] = await conexao.execute(
      `
      INSERT INTO pedidos
      (
        cliente_id,
        produto_id,
        quantidade,
        valor_unitario,
        valor_total,
        status
      )
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        clienteId,
        produtoId,
        quantidade,
        valorUnitario,
        valorTotal,
        "aguardando_pagamento"
      ]
    );

    // -------------------------------
    // DIMINUIR ESTOQUE
    // -------------------------------

    await conexao.execute(
      `
      UPDATE produtos

      SET estoque = estoque - ?

      WHERE id = ?
      `,
      [
        quantidade,
        produtoId
      ]
    );

    // -------------------------------
    // FINALIZAR TRANSAÇÃO
    // -------------------------------

    await conexao.commit();

    // -------------------------------
    // RESPOSTA
    // -------------------------------

    res.status(201).json({

      ok: true,

      pedido_id: pedido.insertId,

      cliente_id: clienteId,

      produto_id: produtoId,

      produto_nome: produto.nome,

      quantidade: quantidade,

      valor_unitario: valorUnitario,

      valor_total: valorTotal,

      status: "aguardando_pagamento"

    });

  } catch (erro) {

    try {
      await conexao.rollback();
    } catch (_) {}

    console.error(erro);

    res.status(500).json({
      erro: "Erro ao criar pedido."
    });

  } finally {

    conexao.release();

  }
});

// ===============================
// CONFERIR PEDIDO
// ===============================

app.post("/api/conferir-pedido", async (req, res) => {

  try {

    const nome = String(req.body.nome || "").trim();

    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();

    const cpf = String(req.body.cpf || "").trim();

    if (!nome || !email || !cpf) {

      return res.status(400).json({
        erro: "Informe nome completo, e-mail e CPF."
      });

    }

    const [pedidos] = await db.execute(
      `
      SELECT

        p.id AS pedido_id,

        p.criado_em,

        p.quantidade,

        p.valor_unitario,

        p.valor_total,

        p.status,

        c.id AS cliente_id,

        c.nome AS cliente_nome,

        c.email,

        c.telefone,

        c.cpf,

        pr.id AS produto_id,

        pr.nome AS produto_nome,

        pr.imagem

      FROM pedidos p

      INNER JOIN clientes c
        ON c.id = p.cliente_id

      INNER JOIN produtos pr
        ON pr.id = p.produto_id

      WHERE LOWER(c.nome) = LOWER(?)

      AND LOWER(c.email) = LOWER(?)

      AND c.cpf = ?

      ORDER BY p.id DESC
      `,
      [
        nome,
        email,
        cpf
      ]
    );

    res.json({

      ok: true,

      pedidos: pedidos

    });

  } catch (erro) {

    console.error(erro);

    res.status(500).json({
      erro: "Erro ao consultar pedido."
    });

  }
});

// ===============================
// TRATAMENTO DE ROTA INEXISTENTE
// ===============================

app.use((req, res) => {

  res.status(404).json({
    erro: "Rota não encontrada."
  });

});

// ===============================
// INICIAR SERVIDOR
// ===============================

app.listen(PORT, () => {

  console.log(
    `Servidor LUXOR funcionando na porta ${PORT}`
  );

});