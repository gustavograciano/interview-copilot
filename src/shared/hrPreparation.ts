import type { AppSettings } from './types';

// This preset changes presentation only. Personal screening facts stay in the
// local settings store, outside the public source repository.
export function recruiterPreset(): Partial<AppSettings> {
  return {
    interviewStyle: 'hr', interviewLanguage: 'en', showTranslation: true,
    answerLength: 'concise', triggerMode: 'manual', tone: 'conversational',
  };
}

export function screeningFacts(s: Pick<AppSettings, 'recruiterContext' | 'employmentSituation' | 'noticePeriod' | 'weeklyAvailability'>): string {
  return [
    s.recruiterContext,
    `Current employment situation (current, overrides dated CV entries): ${s.employmentSituation.trim() || 'NOT PROVIDED — do not guess'}`,
    `Start date / notice period: ${s.noticePeriod.trim() || 'NOT PROVIDED — do not guess'}`,
    `Weekly hours / time zone overlap: ${s.weeklyAvailability.trim() || 'NOT PROVIDED — do not promise full-time, 40 hours, a time zone or a schedule'}`,
  ].join('\n\n');
}

export interface HrQuestion {
  id: string;
  topic: string;
  question: string;
  questionPt: string;
  answer: string;
  answerPt: string;
  note?: string;
}

const COMMON_QUESTIONS: Omit<HrQuestion, 'answer' | 'answerPt'>[] = [
  {
    "id": "intro",
    "topic": "Apresentação",
    "question": "Tell me about yourself.",
    "questionPt": "Fale um pouco sobre você."
  },
  {
    "id": "employment",
    "topic": "Emprego atual",
    "question": "Are you currently employed?",
    "questionPt": "Você está empregado atualmente?"
  },
  {
    "id": "start",
    "topic": "Início",
    "question": "When could you start? Do you have a notice period?",
    "questionPt": "Quando poderia começar? Precisa cumprir aviso prévio?"
  },
  {
    "id": "salary",
    "topic": "Remuneração",
    "question": "What are your salary expectations?",
    "questionPt": "Qual é sua pretensão de remuneração?"
  },
  {
    "id": "english",
    "topic": "Inglês",
    "question": "How would you describe your English level?",
    "questionPt": "Como você descreveria seu nível de inglês?"
  },
  {
    "id": "motivation",
    "topic": "Motivação",
    "question": "Why are you interested in this role?",
    "questionPt": "Por que você se interessou por esta vaga?"
  },
  {
    "id": "search",
    "topic": "Busca atual",
    "question": "Why are you looking for a new opportunity?",
    "questionPt": "Por que está buscando uma nova oportunidade?"
  },
  {
    "id": "fit",
    "topic": "Diferencial",
    "question": "Why should we hire you?",
    "questionPt": "Por que deveríamos contratar você?"
  },
  {
    "id": "stack",
    "topic": "Python / Node",
    "question": "Your main stack is .NET. How do you fit a Python or Node.js role?",
    "questionPt": "Sua stack principal é .NET. Como se encaixa em uma vaga Python ou Node.js?"
  },
  {
    "id": "erp",
    "topic": "SAP / Dynamics",
    "question": "Do you have experience with SAP or Dynamics?",
    "questionPt": "Você tem experiência com SAP ou Dynamics?"
  },
  {
    "id": "aws",
    "topic": "AWS",
    "question": "What is your experience with AWS?",
    "questionPt": "Qual é sua experiência com AWS?"
  },
  {
    "id": "soap",
    "topic": "SOAP / OData",
    "question": "Have you worked with SOAP or OData?",
    "questionPt": "Você já trabalhou com SOAP ou OData?"
  },
  {
    "id": "iac",
    "topic": "CI/CD e IaC",
    "question": "What is your experience with CI/CD and Infrastructure as Code?",
    "questionPt": "Qual é sua experiência com CI/CD e infraestrutura como código?"
  },
  {
    "id": "postgres",
    "topic": "PostgreSQL",
    "question": "How much experience do you have with PostgreSQL?",
    "questionPt": "Quanto tempo de experiência você tem com PostgreSQL?"
  },
  {
    "id": "hours",
    "topic": "Disponibilidade",
    "question": "Are you available full-time? Can you work our time zone?",
    "questionPt": "Você tem disponibilidade integral? Pode trabalhar no nosso fuso?"
  },
  {
    "id": "contract",
    "topic": "Contrato",
    "question": "Are you comfortable with a contractor agreement?",
    "questionPt": "Você se sente confortável com um contrato de prestação de serviços?"
  },
  {
    "id": "weakness",
    "topic": "Desenvolvimento",
    "question": "What is an area you are working to improve?",
    "questionPt": "Qual é uma área em que está buscando melhorar?"
  },
  {
    "id": "challenge",
    "topic": "Desafio real",
    "question": "Tell me about a challenging project.",
    "questionPt": "Conte sobre um projeto desafiador."
  },
  {
    "id": "repeat",
    "topic": "Pedir repetição",
    "question": "Could you repeat or rephrase the question?",
    "questionPt": "Como pedir para repetir ou reformular a pergunta?"
  },
  {
    "id": "thinking",
    "topic": "Ganhar tempo",
    "question": "How can I ask for a moment to think?",
    "questionPt": "Como pedir um instante para pensar?"
  },
  {
    "id": "questions",
    "topic": "Perguntar à RH",
    "question": "Do you have any questions for me?",
    "questionPt": "Você tem alguma pergunta para mim?"
  }
];

export function hrQuestions(s: Pick<AppSettings, 'employmentSituation' | 'noticePeriod' | 'weeklyAvailability' | 'hrPreparedQuestions'>): HrQuestion[] {
  const prepared = s.hrPreparedQuestions || [];
  return COMMON_QUESTIONS.map((q) => {
    const saved = prepared.find((item) => item.id === q.id);
    const result: HrQuestion = saved ? { ...saved } : {
      ...q, answer: '', answerPt: 'Prepare uma resposta verdadeira usando o contexto confirmado nas configurações.',
    };
    if (q.id === 'employment') result.answer = s.employmentSituation.trim();
    if (q.id === 'start') result.answer = s.noticePeriod.trim();
    if (q.id === 'hours') result.answer = s.weeklyAvailability.trim() || result.answer;
    if (saved && result.answer !== saved.answer) result.answerPt = 'Resposta atualizada nas configurações. Confira o texto em inglês acima.';
    return result;
  });
}
