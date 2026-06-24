import { createInterface } from 'readline';

function rl() {
  return createInterface({ input: process.stdin, output: process.stdout });
}

export function ask(question, defaultVal) {
  return new Promise((resolve) => {
    const iface = rl();
    const prompt = defaultVal ? `${question} [${defaultVal}]: ` : `${question}: `;
    iface.question(prompt, (answer) => {
      iface.close();
      resolve(answer.trim() || defaultVal || '');
    });
  });
}

export async function choose(question, options) {
  console.log(`\n${question}`);
  options.forEach((opt, i) => console.log(`  ${i + 1}) ${opt}`));
  while (true) {
    const answer = await ask(`Enter number (1-${options.length})`);
    const idx = parseInt(answer, 10) - 1;
    if (idx >= 0 && idx < options.length) return options[idx];
    console.log(`  Please enter a number between 1 and ${options.length}.`);
  }
}

export async function pickSource(config, verb) {
  if (!config.sources.length) return null;
  if (config.sources.length === 1) return config.sources[0].id;
  const labels = config.sources.map(s => `${s.id}  (${s.type})`);
  const chosen = await choose(`Which source do you want to ${verb}?`, labels);
  return config.sources[labels.indexOf(chosen)].id;
}
