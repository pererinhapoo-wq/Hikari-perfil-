# Hikari — Site de Perfis de Usuários

Plataforma social independente e moderna voltada para os perfis dos usuários da comunidade de animes Hikari, com identidade visual sofisticada em tema escuro com detalhes roxos, preparada para expansão com Firebase e integração futura com o ecossistema principal.

---

### Decisões Confirmadas com o Usuário

- **Banco de Dados & Autenticação**: Firebase Auth e Firestore (plano Spark gratuito, sem necessidade de cartão de crédito), garantindo autenticação com Google, sincronização em tempo real de seguidores e regras de segurança para perfis privados.
- **Foco da Etapa 1**: Construção da interface visual completa, responsiva e interativa (cabeçalho Hikari, banner, avatar personalizável, abas de navegação, modal de seguidores, menu de usuário e cards de animes/comentários) com estado reativo local para validação imediata.
- **Identidade Estética**: Tema escuro moderno com profundidade de vidro (*glassmorphism* suave), acentos em roxo vibrante (`#8B5CF6`, `#A855F7`), tipografia nítida e animações sutis de transição.

---

## 1. Visão Geral e Conceito do Produto

O **Hikari Perfis** funciona como a central de identidade e interação social dos membros da comunidade Hikari. Cada usuário possui uma página de perfil personalizável, com banner e foto, contadores de seguidores, gerenciamento de privacidade (público vs. privado), listas categorizadas de animes, histórico de comentários do site principal e linha do tempo de atividades.

### Público-Alvo e Contexto
- Fãs de anime que desejam exibir suas preferências, listas e atividades.
- Usuários que valorizam controle fino de privacidade (perfis restritos, aprovação de solicitações de seguidor e ocultação de comentários).
- Usuários em celulares, tablets e computadores desktop.

### Proposta de Valor
- Experiência visual de alto padrão inspirada nas melhores redes sociais e plataformas de streaming de anime.
- Transparência total sobre relacionamentos (solicitações pendentes, bloqueios e seguidores mútuos).
- Arquitetura limpa e desacoplada, pronta para consumir as APIs do Hikari principal sem amarras prévias.

---

## 2. Experiência do Usuário e Design Visual

### Jornada do Usuário (Fluxos Principais)
1. **Navegação no Cabeçalho**:
   - Logotipo Hikari com brilho roxo sutil.
   - Barra de busca com atalho de teclado para localizar perfis.
   - Sino de notificações com contador de não lidas e painel suspenso organizado por categorias (novos seguidores, solicitações, curtidas).
   - Avatar do usuário que aciona o **Menu Pessoal** com 7 opções estritas (Meu Perfil, Configurações, Seguidores e Seguindo, Notificações, Contas Conectadas, Segurança e Conta, Sair da Conta). A opção "Minha Lista" não faz parte deste menu.
2. **Hero do Perfil**:
   - Banner cinematográfico horizontal com gradiente de fusão e opção de troca/remoção.
   - Foto de perfil flutuante com anel de destaque roxo e badge de status de privacidade (Público ou Privado).
   - Nome de exibição, `@username`, biografia com suporte a quebras de linha e data real de criação da conta (ex: *"Membro desde 14 de março de 2024"*).
   - Métricas em números tabulares para seguidores e pessoas que segue (clicáveis para abrir o modal de conexões).
   - Botão de ação inteligente: Se for o próprio perfil exibe *"Editar Perfil"*; se for outro usuário exibe *"Seguir"* (ou *"Solicitar"* se perfil privado), *"Solicitado"* ou *"Seguindo"*.
3. **Navegação por Abas**:
   - **Visão Geral**: Resumo do perfil, estatísticas gerais (episódios assistidos, média de notas, tempo total), destaques de favoritos e atividades recentes.
   - **Animes**: Segmentação por status (*Assistindo*, *Concluídos*, *Planejados*, *Em Espera*, *Abandonados*) com progresso de episódios (ex: `12/24 eps`), nota pessoal e pôsteres com efeito de hover.
   - **Comentários**: Histórico visual dos comentários no site principal Hikari, mostrando o card do anime, número do episódio/tópico, texto do comentário, data relativa e link direto com estado de *"Abrir no Hikari"*. Respeita a opção de privacidade do usuário de ocultar comentários.
   - **Sobre**: Biografia detalhada, data de criação, links sociais externos e preferências públicas.
   - **Atividade**: Linha do tempo cronológica de animes atualizados, notas atribuídas e comentários publicados.
   - **Favoritos**: Grade de animes marcados com estrela em posição de destaque.
4. **Modal de Seguidores e Seguindo**:
   - Abas internas para alternar entre "Seguidores" e "Seguindo".
   - Aba extra para "Solicitações Pendentes" (quando o perfil for privado) permitindo aceitar ou recusar.
   - Ações rápidas: deixar de seguir, remover seguidor e bloquear usuário.
5. **Painel de Configurações**:
   - Edição de nome, `@username`, biografia e avatar/banner.
   - Configurações de Privacidade: Chave seletora de "Perfil Privado" e opção independente de "Exibir histórico de comentários no perfil".
   - Seção de Contas Conectadas preparada para as integrações oficiais com AniList e MyAnimeList (com status "Desconectado" e instruções claras sem solicitar senhas).

### Paleta de Cores e Atmosfera (Tema Escuro com Detalhes Roxos)
- **Fundo Principal (60%)**: `#0A0713` (Preto obsidiana profundo com matiz violeta quase imperceptível).
- **Superfícies & Cartões (30%)**: `#130E24` (Roxo escuro meia-noite) com bordas ultrafinas translúcidas `rgba(168, 85, 247, 0.12)` e vidro acetinado `backdrop-blur-md`.
- **Acentos e Ações (10%)**: `#8B5CF6` (Violeta vibrante) e gradiente com `#A855F7` em botões primários e estados ativos de abas.
- **Tipografia**: `Plus Jakarta Sans` para títulos e cabeçalhos; `DM Sans` para leitura de biografia e comentários; números tabulares (`tabular-nums font-mono`) para contagens e datas.

---

## 3. Decisões de Arquitetura e Soluções Gratuitas

| Requisito | Solução Recomendada | Justificativa e Limites Gratuitos |
| :--- | :--- | :--- |
| **Banco de Dados** | Cloud Firestore | Plano Spark 100% gratuito (sem cartão de crédito). Suporta 50k leituras/dia, 20k escritas/dia, sincronização em tempo real de seguidores e consultas eficientes. |
| **Autenticação** | Firebase Auth | Gratuito e ilimitado para contas por e-mail/senha e login com Google integrado via popup. |
| **Armazenamento de Imagens** | Armazenamento Otimizado (WebP / URLs autenticadas) | Imagens de banner e avatar processadas e comprimidas no cliente (canvas/WebP < 250KB) para garantir velocidade ultrarrápida. |
| **Privacidade e Segurança** | Firestore Security Rules | Validação granular: perfis privados ocultam subcoleções de animes/atividades para visitantes não autorizados; regras de escrita garantem que a data de criação não seja adulterada. |
| **Comentários Hikari** | Schemas desacoplados (`comment_ref`) | Estrutura de metadados contendo `animeId`, `animeTitle`, `episodeNumber`, `commentText`, `createdAt` e `hikariOriginUrl`. |
| **AniList / MyAnimeList** | OAuth 2.0 PKCE Oficial | Preparação dos campos de perfil (`connectedAccounts.anilist`, `connectedAccounts.mal`) sem armazenar senhas, aguardando tokens oficiais. |

---

## 4. Diagrama de Arquitetura e Componentes

```
┌────────────────────────────────────────────────────────────────────────┐
│                        HIKARI PERFIS WEB CLIENT                        │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                            HEADER                                │  │
│  │  [Hikari Logo]     [Busca Rápida]     [Notificações]    [Avatar] │  │
│  └───────────────────────────────────────────────┬──────────────────┘  │
│                                                  │                     │
│                                      ┌───────────┴──────────┐          │
│                                      │   Menu do Usuário    │          │
│                                      │ (7 itens canônicos)  │          │
│                                      └──────────────────────┘          │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                         HERO DO PERFIL                           │  │
│  │  - Banner personalizável & Avatar com anel roxo                  │  │
│  │  - Nome, @username, Bio, Membro desde (data real)                │  │
│  │  - Métricas: Seguidores | Seguindo                               │  │
│  │  - Ações: Editar Perfil / Seguir / Solicitar                     │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                  BARRA DE ABAS DE NAVEGAÇÃO                      │  │
│  │  [Visão Geral] [Animes] [Comentários] [Sobre] [Atividade] [Favs] │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                  │                                     │
│  ┌───────────────────────────────┴──────────────────────────────────┐  │
│  │                    CONTEÚDO DA ABA ATIVA                         │  │
│  │  - Visão Geral: KPIs + Favoritos + Atividade Recente             │  │
│  │  - Animes: Filtros (Assistindo, Concluídos, Planejados, etc.)    │  │
│  │  - Comentários: Cards com referência a episódios Hikari          │  │
│  │  - Sobre: Detalhes, bio expandida, metadados de privacidade      │  │
│  │  - Atividade: Feed cronológico de atualizações                   │  │
│  │  - Favoritos: Grade de animes em destaque                        │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                       MODAIS INTERATIVOS                         │  │
│  │  - Modal de Seguidores / Seguindo / Solicitações Pendentes       │  │
│  │  - Modal / Painel de Configurações & Privacidade                 │  │
│  │  - Seletor de Avatar e Banner com pré-visualização instantânea   │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Plano de Desenvolvimento por Etapas

### Etapa 1: Estrutura Visual, Interatividade e Casos de Uso (Foco Atual)
1. **Identidade Visual e Layout Responsivo**:
   - Criação da paleta de tema escuro com detalhes roxos, efeitos de vidro e tipografia refinada.
   - Header completo com logotipo Hikari, busca funcional, popover de notificações e menu do usuário (com os 7 itens solicitados).
2. **Página de Perfil Rica**:
   - Banner e avatar interativos (com upload local para teste imediato e botões de substituição/remoção).
   - Metadados completos com data real de criação, badges de privacidade e contadores reativos.
   - Alternância entre as 6 abas solicitadas (*Visão Geral*, *Animes*, *Comentários*, *Sobre*, *Atividade*, *Favoritos*).
3. **Simulação de Estados e Interações Sociais**:
   - Alternância de visualização entre "Meu Próprio Perfil" e "Visualizando Outro Usuário" (Público vs. Privado).
   - Teste de ações: Seguir, Solicitar para Seguir, Cancelar Solicitação, Aceitar/Recusar solicitações pendentes, Deixar de seguir e Bloquear.
   - Configurações de privacidade funcionais no estado da sessão (perfil público/privado, exibir/ocultar comentários).
   - Abas de animes com filtros funcionais por status (*Assistindo*, *Concluídos*, etc.).
   - Cards de comentários Hikari com links e metadados contextuais.

### Etapa 2: Persistência Real com Firebase (Após Aprovação da Etapa 1)
- Ativação do Firebase via fluxo seguro do AI Studio (sem necessidade de cartão de crédito).
- Criação do esquema no Firestore (`users`, `anime_lists`, `comments_history`, `follows`, `notifications`).
- Cadastro e login por e-mail/senha e Google Sign-In.
- Configuração e deploy das `firestore.rules` para garantir total privacidade.

### Etapa 3: Integração Futura com Hikari Principal & Contas Externas
- Mecanismo de webhook/API para receber comentários do site Hikari principal.
- Integração OAuth com AniList e MyAnimeList para sincronização de listas.
