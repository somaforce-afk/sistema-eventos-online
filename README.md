# Seu sistema de eventos, na sua conta

Convites, inscrições, QR permanente, check-in, participantes e certificados. Cada empresa publica a própria instalação, com banco e acesso separados, usando somente o navegador.

Não é necessário instalar Node.js, abrir um terminal ou executar arquivos no computador. O fluxo funciona pelo navegador no Mac e no Windows. A preparação dos arquivos acontece nos servidores de construção da Cloudflare.

## Instalar na minha conta

[![Instalar na Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/somaforce-afk/sistema-eventos-online)

1. Entre nas suas próprias contas GitHub e Cloudflare. Crie-as se ainda não tiver.
2. Clique no botão. Autorize a cópia do projeto para a sua conta GitHub.
3. Selecione sua conta Cloudflare, escolha um nome novo para a aplicação e crie um banco D1 novo. Não escolha bancos ou aplicações de outra empresa.
4. Em `INITIAL_ADMIN_PASSWORD`, crie uma senha administrativa de 12 a 128 caracteres. Não use sua senha do GitHub ou da Cloudflare.
5. Confirme a publicação. A Cloudflare prepara as tabelas e publica a aplicação na sua conta.
6. Abra o endereço criado, acrescente `/admin` e entre com a senha que definiu.
7. Em **Minha empresa**, configure nome, logo e cor pelo navegador. Salve e crie o primeiro evento no Dashboard.

O botão exige que este repositório esteja público e acessível. O código não inclui conta de hospedagem, banco, senha, token, participantes, logos ou certificados de uma instalação real. A instalação anterior da Somaforce não é utilizada.

## Usar

Crie o evento e compartilhe o convite. Empresa, Nome e Telefone são obrigatórios. Inscrição antecipada não gera QR individual. No dia, abra o check-in no Dashboard e use o QR permanente para confirmar presença pelo telefone. Inscrições e check-in têm controles separados. Participantes, relatórios e certificados ficam dentro de cada evento.

Configure Telegram apenas se desejar, com seu bot e grupo. WhatsApp prepara compartilhamentos e lembretes manuais; não há disparo automático. Certificados são liberados após presença e configuração do modelo, com opção de impressão em lote. Equipe de recepção e lista de espera são opcionais.

## Contas e manutenção

Hospedagem, repositório, banco, dados e eventuais custos de consumo pertencem ao cliente e seguem o plano dele. Não há contratação automática de plano pago. Guarde a senha e os acessos às suas contas. Backup, domínio próprio e suporte são combinados separadamente; não há rotina automática de backup nesta versão.

O código é público conforme a autorização do responsável pelo projeto. As condições comerciais de uso e suporte são definidas pelo responsável pelo projeto. Preserve os avisos MIT dos componentes incluídos em `pdf-lib-LICENSE.md` e no gerador de QR.

Referência do fluxo: [Deploy to Cloudflare](https://developers.cloudflare.com/workers/platform/deploy-buttons/).
