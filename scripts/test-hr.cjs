const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

function load(file, stubs = {}, expose = '') {
  const source = fs.readFileSync(file, 'utf8') + expose;
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  new Function('exports', 'require', 'module', js)(mod.exports, (name) => {
    if (!(name in stubs)) throw new Error(`Unexpected dependency: ${name}`);
    return stubs[name];
  }, mod);
  return mod.exports;
}

const hr = load('src/shared/hrPreparation.ts');
const types = load('src/shared/types.ts');
const settings = {
  ...hr.recruiterPreset(), resume: 'Existing CV with an older employer',
  jobDescription: 'Backend integrations', examples: 'TECHNICAL_EXAMPLE_SHOULD_NOT_LEAK', hrExamples: '',
  recruiterContext: 'Compensation: USD 38 per hour. English: intermediate B1–B2. SAP is not a specialty.',
  employmentSituation: 'I am a freelancer without active contracts.', noticePeriod: 'I can start immediately.',
  weeklyAvailability: '', hrPreparedQuestions: [], technicalPreparedQuestions: [], activeTestContext: '',
};
const claude = load('src/main/claude.ts', {
  '@anthropic-ai/sdk': {}, '../shared/types': types, './store': { getSettings: () => settings },
  './solution': { getSolutionBundle: () => '' }, './sessionLog': {}, '../shared/hrPreparation': hr,
}, '\nexports.buildSystemBlocksForTest = buildSystemBlocks; exports.buildCodingBlocksForTest = buildCodingSystemBlocks;');
const prompt = claude.buildSystemBlocksForTest().map((b) => b.text).join('\n');
assert.match(prompt, /USD 38 per hour/);
assert.match(prompt, /B1–B2/);
assert.match(prompt, /without active contracts/);
assert.match(prompt, /start immediately/);
assert.match(prompt, /do not promise full-time, 40 hours/);
assert.match(prompt, /override older CV/);
assert.match(prompt, /<<<TRANSLATION>>>/);
assert.match(prompt, /in English/);
assert.doesNotMatch(prompt, /TECHNICAL_EXAMPLE_SHOULD_NOT_LEAK/);
const empty = hr.screeningFacts({ recruiterContext: '', employmentSituation: '', noticePeriod: '', weeklyAvailability: '' });
assert.equal((empty.match(/NOT PROVIDED/g) || []).length, 3);
assert.equal(Object.hasOwn(hr.recruiterPreset(), 'resume'), false);
assert.equal(Object.hasOwn(hr.recruiterPreset(), 'employmentSituation'), false);
const questions = hr.hrQuestions(settings);
assert.equal(questions.length, 21);
assert.equal(new Set(questions.map((q) => q.id)).size, questions.length);
assert.equal(questions.find((q) => q.id === 'employment').answer, settings.employmentSituation);
assert.equal(questions.find((q) => q.id === 'hours').answer, '');
const clarification = { ...questions.find((q) => q.id === 'hours'), answer: 'What weekly hours would you need?' };
assert.equal(hr.hrQuestions({ ...settings, hrPreparedQuestions: [clarification] }).find((q) => q.id === 'hours').answer, clarification.answer);
assert.equal(hr.hrQuestions({ ...settings, weeklyAvailability: 'Twenty hours per week.', hrPreparedQuestions: [clarification] }).find((q) => q.id === 'hours').answer, 'Twenty hours per week.');
const saved = { ...questions[0], answer: 'A real, confirmed introduction.' };
const personalized = hr.hrQuestions({ ...settings, hrPreparedQuestions: [saved] });
assert.equal(personalized[0].answer, saved.answer);
personalized[0].answer = 'Edited';
assert.equal(saved.answer, 'A real, confirmed introduction.');
settings.interviewStyle = 'technical';
assert.match(claude.buildSystemBlocksForTest().map((b) => b.text).join('\n'), /TECHNICAL_EXAMPLE_SHOULD_NOT_LEAK/);
settings.jobDescription = 'CURRENT ROLE: Python OR TypeScript/Node.js ERP integrations. ROLE_MARKER';
settings.resume = 'Candidate historical primary stack is C# and .NET. RESUME_MARKER';
const codingPrompt = claude.buildCodingBlocksForTest().map((b) => b.text).join('\n');
assert.match(codingPrompt, /ROLE_MARKER/);
assert.match(codingPrompt, /RESUME_MARKER/);
assert.match(codingPrompt, /choose from the ACTIVE TARGET ROLE/);
assert.match(codingPrompt, /prefer Python unless/);
assert.match(codingPrompt, /language explicitly requested by the interviewer/);
assert.doesNotMatch(codingPrompt, /default to C# \/ .NET/);
assert.match(codingPrompt, /USD 38 per hour/);
settings.jobDescription = '';
assert.match(claude.buildCodingBlocksForTest().map((b) => b.text).join('\n'), /No target role configured/);
console.log('Screening checks passed: grounding, mode isolation, missing logistics, prepared answers and role-aware coding language.');
