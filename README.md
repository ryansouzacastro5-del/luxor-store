# LUXOR — Loja + MariaDB + PagBank

## Fluxo
1. Cliente clica em **COMPRAR**.
2. Preenche os dados em `checkout.html`.
3. O servidor grava o pedido no MariaDB.
4. O servidor cria um Checkout PagBank.
5. O cliente é redirecionado para o ambiente seguro do PagBank.
6. O PagBank envia notificações ao `/api/pagbank/webhook`.
7. O pedido é atualizado no MariaDB conforme o status recebido.

A integração usa o Checkout hospedado do PagBank, evitando armazenar dados de cartão no seu site. O Checkout do PagBank permite configurar cartão, Pix e boleto e retornar o cliente para sua loja.

## Configuração
Copie `.env.example` para `.env` e preencha:
- `APP_URL`: URL pública do Render, por exemplo `https://sua-loja.onrender.com`
- `PAGBANK_ENV=sandbox` durante os testes.
- `PAGBANK_TOKEN`: token da API PagBank.
- dados do MariaDB.

Depois execute:
```bash
npm install
npm start
```

## Banco
Execute `db/schema.sql` no MariaDB antes de iniciar as vendas.

## PagBank
Para testes, use o ambiente Sandbox. Para produção, altere `PAGBANK_ENV=production` e use o token de produção. O endpoint de criação de Checkout é feito no servidor, nunca expondo o token no HTML.

## Importante
O `APP_URL` precisa ser público para o webhook funcionar em produção. Em `localhost`, o redirecionamento funciona, mas o PagBank não consegue chamar o webhook pela internet.

## Consulta do pedido após o pagamento

Depois que o cliente retorna do PagBank, ele é direcionado para `pagamento-retorno.html`.
Nessa página informa nome completo e CPF. O servidor consulta o MariaDB e só exibe o relatório quando o pedido estiver com `status = pago`.

A consulta retorna os dados cadastrados do pedido, produto, valor, status do pagamento, cliente e endereço. A comparação de nome e CPF é feita no servidor.


## Painel administrativo

Depois de configurar `ADMIN_USER` e `ADMIN_PASSWORD` no Render, acesse:

`https://SEU-DOMINIO.onrender.com/admin`

O painel mostra somente pedidos com `status='pago'`, o total recebido, quantidade de vendas e permite abrir os dados completos de cada cliente. A autenticação usa Basic Auth e deve ser acessada por HTTPS.
