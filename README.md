# Trajeville — sistema de locação de trajes típicos alemães

Site público + catálogo + reservas + estoque por período + painel administrativo, em um único servidor.

## Como rodar (3 comandos)

Requer **Node.js ≥ 22.13**.

```bash
npm install
npm run demo      # opcional: cria 3 trajes de DEMONSTRAÇÃO (sem fotos)
npm run dev       # compila o frontend e inicia o servidor
```
Abra **http://localhost:3000** (site) e **http://localhost:3000/admin** (painel).

Na primeira execução o terminal mostra o e-mail e uma **senha aleatória** do administrador (exibida uma única vez; não existe senha padrão).
Para criar mais usuários ou redefinir senha:
`EMAIL=ana@exemplo.com NOME="Ana" SENHA='senha-forte-123' PERFIL=STAFF npm run create-user`
(ADMIN altera configurações; STAFF opera reservas, estoque e clientes.)

### Primeiros passos no painel
1. **Configurações** → informe o **WhatsApp** (enquanto vazio, o site esconde os botões de WhatsApp; nada é inventado) e o endereço/horário.
2. **Trajes** → cadastre os trajes reais com os tamanhos que cada um realmente tem (escala PP → XXG) e **envie as fotos reais**. Apague os de demonstração.
3. **Galeria** → envie fotos reais; use "Usar no topo" para a foto do hero da home.
4. **FAQ** → revise as respostas conforme as regras reais da Trajeville.

## Produção
Variáveis de ambiente: `NODE_ENV=production`, `SESSION_SECRET` (≥32 caracteres, obrigatório), `ADMIN_EMAIL` + `ADMIN_PASSWORD` (primeira execução), `SITE_URL` (ex.: `https://trajeville.com.br`, usada no SEO/sitemap),
`SECURE_COOKIES=1` (HTTPS), `TRUST_PROXY=1` (atrás de proxy reverso), `PORT`, `DATABASE_PATH`, `UPLOAD_DIR`.
Faça **backup periódico da pasta `data/`** (banco + fotos). Rode `npm run build` no deploy e `npm start`. Uma única instância (SQLite); veja "Limites" abaixo.

## Testes
```bash
npm test          # 51 testes: regras de negócio + API HTTP (segurança, overbooking, fluxo, upload, SEO)
npm run test:e2e  # 12 testes em NAVEGADOR REAL (precisa: npx playwright install chromium)
```
O E2E percorre: reserva pública em grupo → bloqueio de estoque em tempo real → login → confirmar → prova → ajuste → retirada → devolução com manutenção → liberar para estoque → upload de foto → WhatsApp → mobile.

## Arquitetura
```
server/domain/      regras puras (tamanhos PP→XXG, status, transições, datas, DISPONIBILIDADE)
server/services/    catálogo, reservas (criação atômica), operação (prova/ajuste/devolução/manutenção/atraso), admin
server/http/        servidor HTTP, rotas públicas e /api/admin, segurança, SEO por rota, uploads
server/db/          schema.sql (SQLite; portável para PostgreSQL)
web/src/            React + TypeScript (site público em /, painel em /admin)
tests/              unitários, API e e2e
```
O frontend importa do servidor apenas os módulos **puros** (tamanhos, status, validação de datas): as mesmas regras e mensagens valem no navegador e no servidor. A disponibilidade **nunca** é calculada no navegador; `/api/public/check` é só informativo e a validação definitiva ocorre dentro da transação de criação.

### Como o estoque é calculado
`disponível(período) = estoque_total − manutenção_aberta − PICO de unidades comprometidas no período`
Cancelar ou devolver não mexe em contadores: o item simplesmente deixa de comprometer estoque. Atraso mantém a peça indisponível. Manutenção só termina em "Liberar para estoque". Pendentes bloqueiam conforme a configuração (padrão: sim).

### Segurança
Senhas com scrypt; sessão em cookie `HttpOnly` + `SameSite=Strict` (+ `Secure` em HTTPS); CSRF por cabeçalho customizado + checagem de Origin; limite de tentativas de login e de solicitações; honeypot anti-robô; upload validado pelos **bytes** (JPG/PNG/WebP, 10 MB), nome aleatório, servido com `nosniff`; CSP restritiva; perfis ADMIN/STAFF; API pública nunca expõe estoque total, clientes ou dados internos.

### SEO
Título, descrição, canonical, Open Graph e JSON-LD (`ClothingStore`, `Product`) injetados **pelo servidor** em cada rota (funciona para buscadores e prévias do Instagram/WhatsApp), `sitemap.xml`, `robots.txt`, 404 real. Produtos de demonstração e o painel recebem `noindex` e ficam fora do sitemap.

## Decisões a revisar
1. Prova é opcional (confirmada → pronto para retirada é permitido).
2. Manutenção bloqueia a unidade em todos os períodos futuros até a liberação manual.
3. Cancelamento só antes da retirada.
4. Estoque total não pode ser reduzido abaixo do já comprometido.
5. O fluxo público tem 4 telas (traje·tamanho·quantidade → datas → dados → resumo/envio) que cobrem as 9 etapas da especificação.
6. Frontend empacotado com **esbuild** e CSS próprio com tokens de design (veja "Desvios").

## Desvios em relação ao pedido original (e por quê)
- **Vite → esbuild; Tailwind → CSS próprio.** O ambiente onde construí o projeto não tinha acesso ao npm, então não podia instalar nem verificar Vite/Tailwind, e preferi entregar um frontend 100% verificado a estilos não testados. O build (`scripts/build.mjs`) é um arquivo de 25 linhas; migrar para Vite/Tailwind é viável depois, pois os componentes são React/TS padrão.
- **Sem checagem de tipos do frontend (`tsc`)**: faltavam `@types/react`/`@types/node` offline. Após `npm install`, rode `npm run typecheck` e me envie eventuais avisos.

## Limites conhecidos / próximos passos
- Reservas feitas por telefone/balcão ainda não têm formulário no painel (a API `createReservation` já suporta; falta a tela).
- Não há status próprio para "cliente confirmou e não compareceu" (hoje: cancelar).
- Fotos são servidas como enviadas (sem redimensionar). Para melhor desempenho no celular, envie imagens de até ~1600 px ou adicione compressão (`sharp`).
- Não há e-mail/WhatsApp automático ao cliente (o contato é pelo botão de WhatsApp).
- SQLite atende bem uma loja; para várias instâncias troque por PostgreSQL (ponto de troca documentado em `server/db/connection.ts`).
- Fontes (Fraunces, Instrument Sans) vêm do Google Fonts; sem internet o site usa fontes de reserva.
