/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Base abrangente de Estados, Capitais e Municípios do Brasil para Autocomplete no Onboarding.
 */

export interface BrazilLocation {
  name: string;
  state: string;
  uf: string;
  type: 'cidade' | 'estado';
  displayName: string;
}

export const BRAZIL_STATES: BrazilLocation[] = [
  { name: 'Acre', state: 'Acre', uf: 'AC', type: 'estado', displayName: 'Acre (AC)' },
  { name: 'Alagoas', state: 'Alagoas', uf: 'AL', type: 'estado', displayName: 'Alagoas (AL)' },
  { name: 'Amapá', state: 'Amapá', uf: 'AP', type: 'estado', displayName: 'Amapá (AP)' },
  { name: 'Amazonas', state: 'Amazonas', uf: 'AM', type: 'estado', displayName: 'Amazonas (AM)' },
  { name: 'Bahia', state: 'Bahia', uf: 'BA', type: 'estado', displayName: 'Bahia (BA)' },
  { name: 'Ceará', state: 'Ceará', uf: 'CE', type: 'estado', displayName: 'Ceará (CE)' },
  { name: 'Distrito Federal', state: 'Distrito Federal', uf: 'DF', type: 'estado', displayName: 'Distrito Federal (DF)' },
  { name: 'Espírito Santo', state: 'Espírito Santo', uf: 'ES', type: 'estado', displayName: 'Espírito Santo (ES)' },
  { name: 'Goiás', state: 'Goiás', uf: 'GO', type: 'estado', displayName: 'Goiás (GO)' },
  { name: 'Maranhão', state: 'Maranhão', uf: 'MA', type: 'estado', displayName: 'Maranhão (MA)' },
  { name: 'Mato Grosso', state: 'Mato Grosso', uf: 'MT', type: 'estado', displayName: 'Mato Grosso (MT)' },
  { name: 'Mato Grosso do Sul', state: 'Mato Grosso do Sul', uf: 'MS', type: 'estado', displayName: 'Mato Grosso do Sul (MS)' },
  { name: 'Minas Gerais', state: 'Minas Gerais', uf: 'MG', type: 'estado', displayName: 'Minas Gerais (MG)' },
  { name: 'Pará', state: 'Pará', uf: 'PA', type: 'estado', displayName: 'Pará (PA)' },
  { name: 'Paraíba', state: 'Paraíba', uf: 'PB', type: 'estado', displayName: 'Paraíba (PB)' },
  { name: 'Paraná', state: 'Paraná', uf: 'PR', type: 'estado', displayName: 'Paraná (PR)' },
  { name: 'Pernambuco', state: 'Pernambuco', uf: 'PE', type: 'estado', displayName: 'Pernambuco (PE)' },
  { name: 'Piauí', state: 'Piauí', uf: 'PI', type: 'estado', displayName: 'Piauí (PI)' },
  { name: 'Rio de Janeiro', state: 'Rio de Janeiro', uf: 'RJ', type: 'estado', displayName: 'Rio de Janeiro (RJ)' },
  { name: 'Rio Grande do Norte', state: 'Rio Grande do Norte', uf: 'RN', type: 'estado', displayName: 'Rio Grande do Norte (RN)' },
  { name: 'Rio Grande do Sul', state: 'Rio Grande do Sul', uf: 'RS', type: 'estado', displayName: 'Rio Grande do Sul (RS)' },
  { name: 'Rondônia', state: 'Rondônia', uf: 'RO', type: 'estado', displayName: 'Rondônia (RO)' },
  { name: 'Roraima', state: 'Roraima', uf: 'RR', type: 'estado', displayName: 'Roraima (RR)' },
  { name: 'Santa Catarina', state: 'Santa Catarina', uf: 'SC', type: 'estado', displayName: 'Santa Catarina (SC)' },
  { name: 'São Paulo', state: 'São Paulo', uf: 'SP', type: 'estado', displayName: 'São Paulo (SP)' },
  { name: 'Sergipe', state: 'Sergipe', uf: 'SE', type: 'estado', displayName: 'Sergipe (SE)' },
  { name: 'Tocantins', state: 'Tocantins', uf: 'TO', type: 'estado', displayName: 'Tocantins (TO)' }
];

export const BRAZIL_CITIES: BrazilLocation[] = [
  // Região Sudeste
  { name: 'São Paulo', state: 'São Paulo', uf: 'SP', type: 'cidade', displayName: 'São Paulo, SP' },
  { name: 'Guarulhos', state: 'São Paulo', uf: 'SP', type: 'cidade', displayName: 'Guarulhos, SP' },
  { name: 'Campinas', state: 'São Paulo', uf: 'SP', type: 'cidade', displayName: 'Campinas, SP' },
  { name: 'São Bernardo do Campo', state: 'São Paulo', uf: 'SP', type: 'cidade', displayName: 'São Bernardo do Campo, SP' },
  { name: 'São José dos Campos', state: 'São Paulo', uf: 'SP', type: 'cidade', displayName: 'São José dos Campos, SP' },
  { name: 'Santo André', state: 'São Paulo', uf: 'SP', type: 'cidade', displayName: 'Santo André, SP' },
  { name: 'Ribeirão Preto', state: 'São Paulo', uf: 'SP', type: 'cidade', displayName: 'Ribeirão Preto, SP' },
  { name: 'Osasco', state: 'São Paulo', uf: 'SP', type: 'cidade', displayName: 'Osasco, SP' },
  { name: 'Sorocaba', state: 'São Paulo', uf: 'SP', type: 'cidade', displayName: 'Sorocaba, SP' },
  { name: 'Santos', state: 'São Paulo', uf: 'SP', type: 'cidade', displayName: 'Santos, SP' },
  { name: 'São José do Rio Preto', state: 'São Paulo', uf: 'SP', type: 'cidade', displayName: 'São José do Rio Preto, SP' },
  { name: 'Mogi das Cruzes', state: 'São Paulo', uf: 'SP', type: 'cidade', displayName: 'Mogi das Cruzes, SP' },
  { name: 'Piracicaba', state: 'São Paulo', uf: 'SP', type: 'cidade', displayName: 'Piracicaba, SP' },
  { name: 'Bauru', state: 'São Paulo', uf: 'SP', type: 'cidade', displayName: 'Bauru, SP' },
  { name: 'Jundiaí', state: 'São Paulo', uf: 'SP', type: 'cidade', displayName: 'Jundiaí, SP' },
  { name: 'Franca', state: 'São Paulo', uf: 'SP', type: 'cidade', displayName: 'Franca, SP' },
  { name: 'Barueri', state: 'São Paulo', uf: 'SP', type: 'cidade', displayName: 'Barueri, SP' },
  { name: 'São Carlos', state: 'São Paulo', uf: 'SP', type: 'cidade', displayName: 'São Carlos, SP' },
  { name: 'Guarujá', state: 'São Paulo', uf: 'SP', type: 'cidade', displayName: 'Guarujá, SP' },
  { name: 'Taubaté', state: 'São Paulo', uf: 'SP', type: 'cidade', displayName: 'Taubaté, SP' },

  { name: 'Rio de Janeiro', state: 'Rio de Janeiro', uf: 'RJ', type: 'cidade', displayName: 'Rio de Janeiro, RJ' },
  { name: 'São Gonçalo', state: 'Rio de Janeiro', uf: 'RJ', type: 'cidade', displayName: 'São Gonçalo, RJ' },
  { name: 'Duque de Caxias', state: 'Rio de Janeiro', uf: 'RJ', type: 'cidade', displayName: 'Duque de Caxias, RJ' },
  { name: 'Nova Iguaçu', state: 'Rio de Janeiro', uf: 'RJ', type: 'cidade', displayName: 'Nova Iguaçu, RJ' },
  { name: 'Niterói', state: 'Rio de Janeiro', uf: 'RJ', type: 'cidade', displayName: 'Niterói, RJ' },
  { name: 'Campos dos Goytacazes', state: 'Rio de Janeiro', uf: 'RJ', type: 'cidade', displayName: 'Campos dos Goytacazes, RJ' },
  { name: 'Belford Roxo', state: 'Rio de Janeiro', uf: 'RJ', type: 'cidade', displayName: 'Belford Roxo, RJ' },
  { name: 'São João de Meriti', state: 'Rio de Janeiro', uf: 'RJ', type: 'cidade', displayName: 'São João de Meriti, RJ' },
  { name: 'Petrópolis', state: 'Rio de Janeiro', uf: 'RJ', type: 'cidade', displayName: 'Petrópolis, RJ' },
  { name: 'Volta Redonda', state: 'Rio de Janeiro', uf: 'RJ', type: 'cidade', displayName: 'Volta Redonda, RJ' },
  { name: 'Macaé', state: 'Rio de Janeiro', uf: 'RJ', type: 'cidade', displayName: 'Macaé, RJ' },
  { name: 'Cabo Frio', state: 'Rio de Janeiro', uf: 'RJ', type: 'cidade', displayName: 'Cabo Frio, RJ' },

  { name: 'Belo Horizonte', state: 'Minas Gerais', uf: 'MG', type: 'cidade', displayName: 'Belo Horizonte, MG' },
  { name: 'Uberlândia', state: 'Minas Gerais', uf: 'MG', type: 'cidade', displayName: 'Uberlândia, MG' },
  { name: 'Contagem', state: 'Minas Gerais', uf: 'MG', type: 'cidade', displayName: 'Contagem, MG' },
  { name: 'Juiz de Fora', state: 'Minas Gerais', uf: 'MG', type: 'cidade', displayName: 'Juiz de Fora, MG' },
  { name: 'Betim', state: 'Minas Gerais', uf: 'MG', type: 'cidade', displayName: 'Betim, MG' },
  { name: 'Montes Claros', state: 'Minas Gerais', uf: 'MG', type: 'cidade', displayName: 'Montes Claros, MG' },
  { name: 'Ribeirão das Neves', state: 'Minas Gerais', uf: 'MG', type: 'cidade', displayName: 'Ribeirão das Neves, MG' },
  { name: 'Uberaba', state: 'Minas Gerais', uf: 'MG', type: 'cidade', displayName: 'Uberaba, MG' },
  { name: 'Governador Valadares', state: 'Minas Gerais', uf: 'MG', type: 'cidade', displayName: 'Governador Valadares, MG' },
  { name: 'Ipatinga', state: 'Minas Gerais', uf: 'MG', type: 'cidade', displayName: 'Ipatinga, MG' },
  { name: 'Sete Lagoas', state: 'Minas Gerais', uf: 'MG', type: 'cidade', displayName: 'Sete Lagoas, MG' },
  { name: 'Divinópolis', state: 'Minas Gerais', uf: 'MG', type: 'cidade', displayName: 'Divinópolis, MG' },
  { name: 'Poços de Caldas', state: 'Minas Gerais', uf: 'MG', type: 'cidade', displayName: 'Poços de Caldas, MG' },

  { name: 'Vitória', state: 'Espírito Santo', uf: 'ES', type: 'cidade', displayName: 'Vitória, ES' },
  { name: 'Vila Velha', state: 'Espírito Santo', uf: 'ES', type: 'cidade', displayName: 'Vila Velha, ES' },
  { name: 'Serra', state: 'Espírito Santo', uf: 'ES', type: 'cidade', displayName: 'Serra, ES' },
  { name: 'Cariacica', state: 'Espírito Santo', uf: 'ES', type: 'cidade', displayName: 'Cariacica, ES' },
  { name: 'Cachoeiro de Itapemirim', state: 'Espírito Santo', uf: 'ES', type: 'cidade', displayName: 'Cachoeiro de Itapemirim, ES' },
  { name: 'Linhares', state: 'Espírito Santo', uf: 'ES', type: 'cidade', displayName: 'Linhares, ES' },

  // Região Centro-Oeste
  { name: 'Brasília', state: 'Distrito Federal', uf: 'DF', type: 'cidade', displayName: 'Brasília, DF' },
  { name: 'Goiânia', state: 'Goiás', uf: 'GO', type: 'cidade', displayName: 'Goiânia, GO' },
  { name: 'Aparecida de Goiânia', state: 'Goiás', uf: 'GO', type: 'cidade', displayName: 'Aparecida de Goiânia, GO' },
  { name: 'Anápolis', state: 'Goiás', uf: 'GO', type: 'cidade', displayName: 'Anápolis, GO' },
  { name: 'Rio Verde', state: 'Goiás', uf: 'GO', type: 'cidade', displayName: 'Rio Verde, GO' },
  { name: 'Luziânia', state: 'Goiás', uf: 'GO', type: 'cidade', displayName: 'Luziânia, GO' },
  { name: 'Águas Lindas de Goiás', state: 'Goiás', uf: 'GO', type: 'cidade', displayName: 'Águas Lindas de Goiás, GO' },
  { name: 'Valparaíso de Goiás', state: 'Goiás', uf: 'GO', type: 'cidade', displayName: 'Valparaíso de Goiás, GO' },
  { name: 'Trindade', state: 'Goiás', uf: 'GO', type: 'cidade', displayName: 'Trindade, GO' },
  { name: 'Formosa', state: 'Goiás', uf: 'GO', type: 'cidade', displayName: 'Formosa, GO' },
  { name: 'Itumbiara', state: 'Goiás', uf: 'GO', type: 'cidade', displayName: 'Itumbiara, GO' },
  { name: 'Jataí', state: 'Goiás', uf: 'GO', type: 'cidade', displayName: 'Jataí, GO' },
  { name: 'Senador Canedo', state: 'Goiás', uf: 'GO', type: 'cidade', displayName: 'Senador Canedo, GO' },
  { name: 'Catalão', state: 'Goiás', uf: 'GO', type: 'cidade', displayName: 'Catalão, GO' },
  { name: 'Cuiabá', state: 'Mato Grosso', uf: 'MT', type: 'cidade', displayName: 'Cuiabá, MT' },
  { name: 'Várzea Grande', state: 'Mato Grosso', uf: 'MT', type: 'cidade', displayName: 'Várzea Grande, MT' },
  { name: 'Rondonópolis', state: 'Mato Grosso', uf: 'MT', type: 'cidade', displayName: 'Rondonópolis, MT' },
  { name: 'Sinop', state: 'Mato Grosso', uf: 'MT', type: 'cidade', displayName: 'Sinop, MT' },
  { name: 'Sorriso', state: 'Mato Grosso', uf: 'MT', type: 'cidade', displayName: 'Sorriso, MT' },
  { name: 'Campo Grande', state: 'Mato Grosso do Sul', uf: 'MS', type: 'cidade', displayName: 'Campo Grande, MS' },
  { name: 'Dourados', state: 'Mato Grosso do Sul', uf: 'MS', type: 'cidade', displayName: 'Dourados, MS' },
  { name: 'Três Lagoas', state: 'Mato Grosso do Sul', uf: 'MS', type: 'cidade', displayName: 'Três Lagoas, MS' },

  // Região Sul
  { name: 'Curitiba', state: 'Paraná', uf: 'PR', type: 'cidade', displayName: 'Curitiba, PR' },
  { name: 'Londrina', state: 'Paraná', uf: 'PR', type: 'cidade', displayName: 'Londrina, PR' },
  { name: 'Maringá', state: 'Paraná', uf: 'PR', type: 'cidade', displayName: 'Maringá, PR' },
  { name: 'Ponta Grossa', state: 'Paraná', uf: 'PR', type: 'cidade', displayName: 'Ponta Grossa, PR' },
  { name: 'Cascavel', state: 'Paraná', uf: 'PR', type: 'cidade', displayName: 'Cascavel, PR' },
  { name: 'São José dos Pinhais', state: 'Paraná', uf: 'PR', type: 'cidade', displayName: 'São José dos Pinhais, PR' },
  { name: 'Foz do Iguaçu', state: 'Paraná', uf: 'PR', type: 'cidade', displayName: 'Foz do Iguaçu, PR' },
  { name: 'Porto Alegre', state: 'Rio Grande do Sul', uf: 'RS', type: 'cidade', displayName: 'Porto Alegre, RS' },
  { name: 'Caxias do Sul', state: 'Rio Grande do Sul', uf: 'RS', type: 'cidade', displayName: 'Caxias do Sul, RS' },
  { name: 'Canoas', state: 'Rio Grande do Sul', uf: 'RS', type: 'cidade', displayName: 'Canoas, RS' },
  { name: 'Pelotas', state: 'Rio Grande do Sul', uf: 'RS', type: 'cidade', displayName: 'Pelotas, RS' },
  { name: 'Santa Maria', state: 'Rio Grande do Sul', uf: 'RS', type: 'cidade', displayName: 'Santa Maria, RS' },
  { name: 'Gravataí', state: 'Rio Grande do Sul', uf: 'RS', type: 'cidade', displayName: 'Gravataí, RS' },
  { name: 'Gramado', state: 'Rio Grande do Sul', uf: 'RS', type: 'cidade', displayName: 'Gramado, RS' },
  { name: 'Novo Hamburgo', state: 'Rio Grande do Sul', uf: 'RS', type: 'cidade', displayName: 'Novo Hamburgo, RS' },
  { name: 'Florianópolis', state: 'Santa Catarina', uf: 'SC', type: 'cidade', displayName: 'Florianópolis, SC' },
  { name: 'Joinville', state: 'Santa Catarina', uf: 'SC', type: 'cidade', displayName: 'Joinville, SC' },
  { name: 'Blumenau', state: 'Santa Catarina', uf: 'SC', type: 'cidade', displayName: 'Blumenau, SC' },
  { name: 'São José', state: 'Santa Catarina', uf: 'SC', type: 'cidade', displayName: 'São José, SC' },
  { name: 'Itajaí', state: 'Santa Catarina', uf: 'SC', type: 'cidade', displayName: 'Itajaí, SC' },
  { name: 'Chapecó', state: 'Santa Catarina', uf: 'SC', type: 'cidade', displayName: 'Chapecó, SC' },
  { name: 'Criciúma', state: 'Santa Catarina', uf: 'SC', type: 'cidade', displayName: 'Criciúma, SC' },
  { name: 'Balneário Camboriú', state: 'Santa Catarina', uf: 'SC', type: 'cidade', displayName: 'Balneário Camboriú, SC' },

  // Região Nordeste
  { name: 'Salvador', state: 'Bahia', uf: 'BA', type: 'cidade', displayName: 'Salvador, BA' },
  { name: 'Feira de Santana', state: 'Bahia', uf: 'BA', type: 'cidade', displayName: 'Feira de Santana, BA' },
  { name: 'Vitória da Conquista', state: 'Bahia', uf: 'BA', type: 'cidade', displayName: 'Vitória da Conquista, BA' },
  { name: 'Camaçari', state: 'Bahia', uf: 'BA', type: 'cidade', displayName: 'Camaçari, BA' },
  { name: 'Juazeiro', state: 'Bahia', uf: 'BA', type: 'cidade', displayName: 'Juazeiro, BA' },
  { name: 'Fortaleza', state: 'Ceará', uf: 'CE', type: 'cidade', displayName: 'Fortaleza, CE' },
  { name: 'Caucaia', state: 'Ceará', uf: 'CE', type: 'cidade', displayName: 'Caucaia, CE' },
  { name: 'Juazeiro do Norte', state: 'Ceará', uf: 'CE', type: 'cidade', displayName: 'Juazeiro do Norte, CE' },
  { name: 'Sobral', state: 'Ceará', uf: 'CE', type: 'cidade', displayName: 'Sobral, CE' },
  { name: 'Recife', state: 'Pernambuco', uf: 'PE', type: 'cidade', displayName: 'Recife, PE' },
  { name: 'Jaboatão dos Guararapes', state: 'Pernambuco', uf: 'PE', type: 'cidade', displayName: 'Jaboatão dos Guararapes, PE' },
  { name: 'Olinda', state: 'Pernambuco', uf: 'PE', type: 'cidade', displayName: 'Olinda, PE' },
  { name: 'Caruaru', state: 'Pernambuco', uf: 'PE', type: 'cidade', displayName: 'Caruaru, PE' },
  { name: 'Petrolina', state: 'Pernambuco', uf: 'PE', type: 'cidade', displayName: 'Petrolina, PE' },
  { name: 'São Luís', state: 'Maranhão', uf: 'MA', type: 'cidade', displayName: 'São Luís, MA' },
  { name: 'Imperatriz', state: 'Maranhão', uf: 'MA', type: 'cidade', displayName: 'Imperatriz, MA' },
  { name: 'Natal', state: 'Rio Grande do Norte', uf: 'RN', type: 'cidade', displayName: 'Natal, RN' },
  { name: 'Mossoró', state: 'Rio Grande do Norte', uf: 'RN', type: 'cidade', displayName: 'Mossoró, RN' },
  { name: 'João Pessoa', state: 'Paraíba', uf: 'PB', type: 'cidade', displayName: 'João Pessoa, PB' },
  { name: 'Campina Grande', state: 'Paraíba', uf: 'PB', type: 'cidade', displayName: 'Campina Grande, PB' },
  { name: 'Maceió', state: 'Alagoas', uf: 'AL', type: 'cidade', displayName: 'Maceió, AL' },
  { name: 'Arapiraca', state: 'Alagoas', uf: 'AL', type: 'cidade', displayName: 'Arapiraca, AL' },
  { name: 'Teresina', state: 'Piauí', uf: 'PI', type: 'cidade', displayName: 'Teresina, PI' },
  { name: 'Parnaíba', state: 'Piauí', uf: 'PI', type: 'cidade', displayName: 'Parnaíba, PI' },
  { name: 'Aracaju', state: 'Sergipe', uf: 'SE', type: 'cidade', displayName: 'Aracaju, SE' },
  { name: 'Nossa Senhora do Socorro', state: 'Sergipe', uf: 'SE', type: 'cidade', displayName: 'Nossa Senhora do Socorro, SE' },

  // Região Norte
  { name: 'Manaus', state: 'Amazonas', uf: 'AM', type: 'cidade', displayName: 'Manaus, AM' },
  { name: 'Parintins', state: 'Amazonas', uf: 'AM', type: 'cidade', displayName: 'Parintins, AM' },
  { name: 'Belém', state: 'Pará', uf: 'PA', type: 'cidade', displayName: 'Belém, PA' },
  { name: 'Ananindeua', state: 'Pará', uf: 'PA', type: 'cidade', displayName: 'Ananindeua, PA' },
  { name: 'Santarém', state: 'Pará', uf: 'PA', type: 'cidade', displayName: 'Santarém, PA' },
  { name: 'Marabá', state: 'Pará', uf: 'PA', type: 'cidade', displayName: 'Marabá, PA' },
  { name: 'Porto Velho', state: 'Rondônia', uf: 'RO', type: 'cidade', displayName: 'Porto Velho, RO' },
  { name: 'Ji-Paraná', state: 'Rondônia', uf: 'RO', type: 'cidade', displayName: 'Ji-Paraná, RO' },
  { name: 'Macapá', state: 'Amapá', uf: 'AP', type: 'cidade', displayName: 'Macapá, AP' },
  { name: 'Santana', state: 'Amapá', uf: 'AP', type: 'cidade', displayName: 'Santana, AP' },
  { name: 'Rio Branco', state: 'Acre', uf: 'AC', type: 'cidade', displayName: 'Rio Branco, AC' },
  { name: 'Cruzeiro do Sul', state: 'Acre', uf: 'AC', type: 'cidade', displayName: 'Cruzeiro do Sul, AC' },
  { name: 'Boa Vista', state: 'Roraima', uf: 'RR', type: 'cidade', displayName: 'Boa Vista, RR' },
  { name: 'Palmas', state: 'Tocantins', uf: 'TO', type: 'cidade', displayName: 'Palmas, TO' },
  { name: 'Araguaína', state: 'Tocantins', uf: 'TO', type: 'cidade', displayName: 'Araguaína, TO' },
  { name: 'Gurupi', state: 'Tocantins', uf: 'TO', type: 'cidade', displayName: 'Gurupi, TO' }
];

export const ALL_BRAZIL_LOCATIONS: BrazilLocation[] = [
  ...BRAZIL_STATES,
  ...BRAZIL_CITIES
];

/**
 * Remove acentuação para busca insensível a diacríticos
 */
function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Busca inteligente de cidades e estados com suporte a busca prefixada e parcial
 */
export function searchBrazilLocations(query: string, maxResults = 10): BrazilLocation[] {
  if (!query || query.trim().length === 0) {
    return [];
  }

  const normalized = normalizeText(query);

  const matched = ALL_BRAZIL_LOCATIONS.filter((loc) => {
    const normName = normalizeText(loc.name);
    const normState = normalizeText(loc.state);
    const normUf = loc.uf.toLowerCase();
    const normDisplay = normalizeText(loc.displayName);

    return (
      normName.startsWith(normalized) ||
      normState.startsWith(normalized) ||
      normUf === normalized ||
      normName.includes(normalized) ||
      normDisplay.includes(normalized)
    );
  });

  // Ordena dando prioridade para quem começa exatamente com o termo pesquisado
  matched.sort((a, b) => {
    const aStartsWith = normalizeText(a.name).startsWith(normalized);
    const bStartsWith = normalizeText(b.name).startsWith(normalized);
    if (aStartsWith && !bStartsWith) return -1;
    if (!aStartsWith && bStartsWith) return 1;
    return a.name.localeCompare(b.name);
  });

  return matched.slice(0, maxResults);
}
