CREATE DATABASE IF NOT EXISTS lojadereilogio
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE lojadereilogio;

CREATE TABLE IF NOT EXISTS pedidos (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    
    produto_id INT NULL,
    produto_nome VARCHAR(255) NOT NULL,
    quantidade INT NOT NULL DEFAULT 1,
    valor DECIMAL(10,2) NOT NULL,

    nome VARCHAR(150) NOT NULL,
    email VARCHAR(150) NOT NULL,
    telefone VARCHAR(30) NULL,
    cpf VARCHAR(20) NULL,

    cep VARCHAR(20) NULL,
    endereco VARCHAR(255) NULL,
    numero VARCHAR(30) NULL,
    complemento VARCHAR(255) NULL,
    cidade VARCHAR(100) NULL,
    estado VARCHAR(50) NULL,

    status VARCHAR(30) NOT NULL DEFAULT 'AGUARDANDO_PAGAMENTO',
    payment_status VARCHAR(50) NOT NULL DEFAULT 'PENDING',

    pagbank_checkout_id VARCHAR(100) NULL,
    pagbank_reference_id VARCHAR(100) NULL,
    pagbank_payment_id VARCHAR(100) NULL,

    criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    INDEX idx_email (email),
    INDEX idx_status (status),
    INDEX idx_payment_status (payment_status),
    INDEX idx_pagbank_checkout_id (pagbank_checkout_id),
    INDEX idx_pagbank_payment_id (pagbank_payment_id)
);
