/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Legislação Brasileira Integrada ao FatosBR
 * Fontes diretas: Repositório Oficial de Leis Brasileiras (ctresb/leis) & Presidência da República:
 * - Lei nº 13.709/2018 (LGPD - Lei Geral de Proteção de Dados Pessoais)
 * - Lei nº 12.965/2014 (Marco Civil da Internet)
 * - Lei nº 8.078/1990 (Código de Defesa do Consumidor - CDC)
 * - Lei nº 9.609/1998 (Lei do Software) & Lei nº 9.610/1998 (Direitos Autorais)
 * 
 * Estrutura balanceada para garantir total transparência e direitos ao CLIENTE (titular de dados e consumidor)
 * e salvaguarda jurídica irrestrita ao DONO DA PLATAFORMA (isenção por notícias de terceiros, proteção de IP e logs).
 */

export interface LegalArticle {
  number: string;
  law: string;
  lawTitle: string;
  title: string;
  text: string;
  beneficiary: 'cliente' | 'plataforma' | 'ambos';
  badge: string;
  practicalApplication: string;
}

export interface LegalSection {
  id: 'terms' | 'lgpd' | 'cdc' | 'owner-rights' | 'dpo';
  title: string;
  shortTitle: string;
  subtitle: string;
  description: string;
  articles: LegalArticle[];
}

export const LEGAL_SECTIONS: LegalSection[] = [
  {
    id: 'terms',
    title: 'Termos de Uso & Condições Gerais de Acesso',
    shortTitle: 'Termos de Uso',
    subtitle: 'Direitos, deveres, regras de conduta e limitação legal de responsabilidade editorial',
    description: 'Estes termos regulam a utilização dos serviços FatosBR, estabelecendo a relação de transparência e segurança jurídica entre o leitor e os administradores da aplicação.',
    articles: [
      {
        number: 'Art. 19',
        law: 'Lei nº 12.965/2014',
        lawTitle: 'Marco Civil da Internet',
        title: 'Isenção de Responsabilidade por Notícias de Terceiros',
        text: 'Com o intuito de assegurar a liberdade de expressão e impedir a censura, o provedor de aplicações de internet somente poderá ser responsabilizado civilmente por danos decorrentes de conteúdo gerado por terceiros se, após ordem judicial específica, não tomar as providências para, no âmbito e nos limites técnicos do seu serviço e dentro do prazo assinalado, tornar indisponível o conteúdo apontado como infringente.',
        beneficiary: 'plataforma',
        badge: 'Proteção ao Dono da Plataforma',
        practicalApplication: 'O FatosBR atua estritamente como curador, indexador e agregador de dados jornalísticos de fontes primárias públicas (Folha, Estadão, Reuters, Valor, Bloomberg etc.). Opiniões, reportagens ou declarações emitidas por terceiros são de responsabilidade exclusiva de seus autores e veículos originais.'
      },
      {
        number: 'Art. 1º e 2º',
        law: 'Lei nº 9.609/1998',
        lawTitle: 'Lei da Propriedade Intelectual de Programa de Computador',
        title: 'Proteção Autoral do Software e Algoritmos Proprietários',
        text: 'O programa de computador é a expressão de um conjunto organizado de instruções em linguagem natural ou codificada, contida em suporte físico de qualquer natureza, de emprego necessário em máquinas automáticas de tratamento da informação. O regime de proteção à propriedade intelectual de programa de computador é o conferido às obras literárias pela legislação de direitos autorais.',
        beneficiary: 'plataforma',
        badge: 'Propriedade Intelectual',
        practicalApplication: 'É expressamente vedado a qualquer usuário ou terceiro praticar engenharia reversa, descompilação, web scraping predatório não autorizado ou apropriação dos algoritmos de clustering, síntese e conciliação editorial do FatosBR.'
      },
      {
        number: 'Art. 7º, I',
        law: 'Lei nº 12.965/2014',
        lawTitle: 'Marco Civil da Internet',
        title: 'Garantia de Inviolabilidade das Comunicações',
        text: 'O acesso à internet é essencial ao exercício da cidadania, e ao usuário são assegurados os seguintes direitos: I - inviolabilidade e sigilo do fluxo de suas comunicações pela internet, salvo por ordem judicial.',
        beneficiary: 'cliente',
        badge: 'Garantia ao Usuário',
        practicalApplication: 'Suas interações, notícias salvas e configurações de interesses são criptografadas e protegidas por autenticação segura, sem interceptação indevida.'
      }
    ]
  },
  {
    id: 'lgpd',
    title: 'Política de Privacidade & Conformidade LGPD',
    shortTitle: 'Privacidade & LGPD',
    subtitle: 'Bases legais, tratamento mínimo e direitos fundamentais do titular de dados (Lei 13.709/2018)',
    description: 'Tratamos seus dados sob os princípios de necessidade e finalidade, garantindo o pleno exercício de todos os direitos previstos na Lei Geral de Proteção de Dados.',
    articles: [
      {
        number: 'Art. 6º',
        law: 'Lei nº 13.709/2018',
        lawTitle: 'LGPD - Princípios Fundamentais',
        title: 'Princípios da Finalidade, Necessidade e Transparência',
        text: 'As atividades de tratamento de dados pessoais deverão observar a boa-fé e os seguintes princípios: I - finalidade: realização do tratamento para propósitos legítimos, específicos, explícitos e informados ao titular; III - necessidade: limitação do tratamento ao mínimo necessário para a realização de suas finalidades; VI - transparência: garantia, aos titulares, de informações claras, precisas e facilmente acessíveis.',
        beneficiary: 'cliente',
        badge: 'Direito do Titular',
        practicalApplication: 'O FatosBR não comercializa nem compartilha dados com corretoras de dados ou redes de publicidade direcionada. Coletamos apenas e-mail, nome e preferências de categorias para compor o feed e disparar briefings.'
      },
      {
        number: 'Art. 18',
        law: 'Lei nº 13.709/2018',
        lawTitle: 'LGPD - Direitos do Titular',
        title: 'Direitos Inalienáveis do Titular de Dados Pessoais',
        text: 'O titular dos dados pessoais tem direito a obter do controlador, em relação aos dados do titular por ele tratados, a qualquer momento e mediante requisição: I - confirmação da existência de tratamento; II - acesso aos dados; III - correção de dados incompletos, inexatos ou desatualizados; IV - anonimização, bloqueio ou eliminação de dados desnecessários; VI - eliminação dos dados pessoais tratados com o consentimento do titular.',
        beneficiary: 'cliente',
        badge: 'Exercício de Direitos',
        practicalApplication: 'Você pode, a qualquer instante, por meio da Central de Privacidade ou no canal do Encarregado (DPO), solicitar o download completo dos seus dados ou a exclusão imediata de sua conta.'
      },
      {
        number: 'Art. 15',
        law: 'Lei nº 12.965/2014',
        lawTitle: 'Marco Civil da Internet',
        title: 'Obrigação Legal de Guarda de Registros de Acesso por 6 Meses',
        text: 'O provedor de aplicações de internet constituído na forma de pessoa jurídica e que exerça essa atividade de forma organizada, profissionalmente e com fins econômicos deverá manter os respectivos registros de acesso a aplicações de internet, sob sigilo, em ambiente controlado e de segurança, pelo prazo de 6 (seis) meses.',
        beneficiary: 'ambos',
        badge: 'Conformidade Legal',
        practicalApplication: 'Em cumprimento estrito à legislação federal, registros técnicos de conexão (endereço IP, data e hora) são mantidos pelo período obrigatório de 6 meses para segurança jurídica mútua e combate a fraudes.'
      }
    ]
  },
  {
    id: 'cdc',
    title: 'Direitos do Consumidor & Pagamentos Pix (CDC)',
    shortTitle: 'Consumidor & Pix',
    subtitle: 'Direito de arrependimento em 7 dias, transparência tarifária e estorno Pix (Lei 8.078/1990)',
    description: 'Regulamentação das assinaturas do FatosBR Pro contratadas eletronicamente, garantindo devolução integral sem burocracia.',
    articles: [
      {
        number: 'Art. 49',
        law: 'Lei nº 8.078/1990',
        lawTitle: 'Código de Defesa do Consumidor (CDC)',
        title: 'Direito de Arrependimento de 7 Dias com Estorno Imediato',
        text: 'O consumidor pode desistir do contrato, no prazo de 7 dias a contar de sua assinatura ou do ato de recebimento do produto ou serviço, sempre que a contratação de fornecimento de produtos e serviços ocorrer fora do estabelecimento comercial, especialmente por telefone ou a domicílio. Parágrafo único: Se o consumidor exercitar o direito de arrependimento, os valores eventualmente pagos serão devolvidos de imediato.',
        beneficiary: 'cliente',
        badge: 'Garantia Incondicional',
        practicalApplication: 'Ao assinar o FatosBR Pro (R$ 29,90 via ZynPay Pix), você tem 7 dias corridos para solicitar o cancelamento com devolução de 100% do valor pago via chave Pix, sem necessidade de justificativa.'
      },
      {
        number: 'Art. 31 e 52',
        law: 'Lei nº 8.078/1990',
        lawTitle: 'Código de Defesa do Consumidor (CDC)',
        title: 'Transparência de Preço e Inexistência de Cobranças Ocultas',
        text: 'A oferta e apresentação de produtos ou serviços devem assegurar informações corretas, claras, precisas, ostensivas e em língua portuguesa sobre suas características, qualidades, quantidade, composição, preço, garantia, prazos de validade e origem.',
        beneficiary: 'cliente',
        badge: 'Transparência Financeira',
        practicalApplication: 'O valor do FatosBR Pro é de exatos R$ 29,90 (2.990 centavos) por mês, discriminado antes de qualquer pagamento. Não há retenção de dados de cartão de crédito e as renovações são expressamente consentidas via Pix.'
      },
      {
        number: 'Art. 14, § 3º',
        law: 'Lei nº 8.078/1990',
        lawTitle: 'Código de Defesa do Consumidor (CDC)',
        title: 'Excludentes de Responsabilidade por Fato de Terceiro',
        text: 'O fornecedor de serviços só não será responsabilizado quando provar: I - que, tendo prestado o serviço, o defeito inexiste; II - a culpa exclusiva do consumidor ou de terceiro.',
        beneficiary: 'plataforma',
        badge: 'Segurança Jurídica',
        practicalApplication: 'Indisponibilidades decorrentes de falhas em operadoras de telecomunicação, ataques cibernéticos em massa ou instabilidade nas chaves de bancos emissores do Pix não configuram inadimplemento da plataforma.'
      }
    ]
  },
  {
    id: 'owner-rights',
    title: 'Salvaguardas & Proteção do Titular da Plataforma',
    shortTitle: 'Proteção da Plataforma',
    subtitle: 'Prevenção contra abusos, ataques DDoS, cópia não autorizada e calúnia/difamação',
    description: 'Mecanismos legais para garantir a integridade da infraestrutura, a reputação da aplicação e a viabilidade operacional contínua.',
    articles: [
      {
        number: 'Art. 9º',
        law: 'Lei nº 9.610/1998',
        lawTitle: 'Lei de Direitos Autorais',
        title: 'Titularidade e Direitos Morais e Patrimoniais',
        text: 'Àquele que goza de direitos de autor assiste a faculdade de usar, fruir e dispor da obra literária, artística ou científica, e de autorizar sua utilização por terceiros, no todo ou em parte.',
        beneficiary: 'plataforma',
        badge: 'Marca & Layout',
        practicalApplication: 'A marca FatosBR, logotipos, ilustrações, design system, código-fonte e estrutura de apresentação são criações protegidas. Sua reprodução para fins comerciais concorrentes enseja sanções cíveis e criminais.'
      },
      {
        number: 'Art. 154-A',
        law: 'Código Penal Brasileiro',
        lawTitle: 'Lei nº 12.737/2012 (Lei Carolina Dieckmann)',
        title: 'Crime de Invasão de Dispositivo Informático',
        text: 'Invadir dispositivo informático de uso alheio, conectado ou não à rede de computadores, com o fim de obter, adulterar ou destruir dados ou informações sem autorização expressa ou tácita do titular do dispositivo ou instalar vulnerabilidades.',
        beneficiary: 'plataforma',
        badge: 'Segurança e Auditoria',
        practicalApplication: 'Tentativas de injeção de SQL, exploração de endpoints não autenticados, bypass do gateway de pagamento ou sobrecarga deliberada da infraestrutura geram bloqueio imediato e notificação às autoridades policiais competentes.'
      }
    ]
  }
];

export interface DpoRequestSubmission {
  id: string;
  timestamp: string;
  protocol: string;
  userName: string;
  userEmail: string;
  requestType: 'confirmation' | 'access' | 'deletion' | 'rectification' | 'revocation';
  details: string;
  status: 'PENDENTE' | 'PROCESSADO' | 'CONCLUÍDO';
}

export const DPO_CONTACT = {
  name: 'Encarregado de Proteção de Dados (DPO FatosBR)',
  email: 'privacidade@fatosbr.com.br',
  dpoOfficer: 'Jurídico & Compliance Digital FatosBR',
  address: 'São Paulo - SP, Brasil',
  responseDeadline: 'Até 15 (quinze) dias úteis nos termos do Art. 19, II da LGPD'
};
