import React, { useMemo, useState } from 'react';
import type { AppSettings, InterviewStyle } from '../shared/types';
import { hrQuestions } from '../shared/hrPreparation';
import './interview.css';

export function HrPreparation({ settings, onPractice }: { settings: AppSettings; onPractice: (question: string, style: InterviewStyle) => void }) {
  const [style, setStyle] = useState<InterviewStyle>('hr');
  const questions = useMemo(() => style === 'hr' ? hrQuestions(settings) : settings.technicalPreparedQuestions || [], [settings, style]);
  const [selected, setSelected] = useState('intro');
  const [search, setSearch] = useState('');
  const current = questions.find((q) => q.id === selected) || questions[0];
  const filtered = questions.filter((q) => `${q.topic} ${q.question} ${q.questionPt}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <div className="hr-prep">
    <nav className="prep-topics" aria-label="Tipo de preparação">
      <button aria-pressed={style === 'hr'} onClick={() => { setStyle('hr'); setSearch(''); }}>Perguntas de RH</button>
      <button aria-pressed={style === 'technical'} onClick={() => { setStyle('technical'); setSearch(''); }}>Perguntas técnicas</button>
    </nav>
    <p className="prep-hint">Roteiro para praticar. Respostas prontas funcionam sem áudio e sem consumir API.</p>
    <label className="prep-search">Buscar pergunta
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Emprego, salário, SAP, inglês…" />
    </label>
    <nav className="prep-topics" aria-label="Perguntas prováveis">
      {filtered.map((q) => <button key={q.id} aria-pressed={q.id === selected} onClick={() => setSelected(q.id)}>{q.topic}</button>)}
      {!filtered.length && <span>Nenhuma pergunta encontrada.</span>}
    </nav>
    {current ? <><section className="prep-question">
      <h2>{style === 'hr' ? 'Pergunta da recrutadora' : 'Pergunta técnica'}</h2>
      <p lang="en">{current.question}</p>
      <p className="portuguese">{current.questionPt}</p>
    </section>
    <section className="prep-answer">
      <h2>Sua resposta em inglês</h2>
      {current.answer ? <p lang="en" className="answer-text">{current.answer}</p> : <p className="prep-hint">Complete os dados nas configurações ou prepare um caso real do seu currículo.</p>}
      <details><summary>Entender em português</summary><p className="portuguese">{current.answerPt}</p></details>
      {current.note && <p className="prep-note">{current.note}</p>}
    </section>
    <button className="practice-button" disabled={!settings.hasAnthropicKey || !settings.recruiterContext.trim()} onClick={() => onPractice(current.question, style)}>Praticar esta pergunta com IA</button></> : <p className="prep-hint">Nenhum roteiro técnico configurado para esta oportunidade.</p>}
    <p className="prep-hint">A prática com IA usa seu currículo e contexto salvo. Confira sua disponibilidade semanal em ⚙.</p>
  </div>;
}
