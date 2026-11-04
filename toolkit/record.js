// Recorder: prints each step as it happens and can write results.md.
// A step has a command, the output and a one-line note.

import { writeFileSync } from 'node:fs';
import { arch, platform, release } from 'node:os';

export class Recorder {
  constructor(title) {
    this.title = title;
    this.steps = [];
  }

  /** Add a step and print it. Output is trimmed. */
  step(command, output, note) {
    const clean = String(output).replace(/\r\n/g, '\n').trimEnd();
    this.steps.push({ command, output: clean, note });
    console.log(`\n$ ${command}`);
    if (clean) console.log(clean);
    console.log(`-> ${note}`);
  }

  /** machine: one line such as "Windows 11, Docker Desktop, Engine 29.9.2, Node 22.22.2". */
  markdown(machine) {
    const head = machine || `${platform()} ${release()} ${arch()}, Node ${process.versions.node}`;
    const date = new Date().toISOString().slice(0, 10);
    const parts = [`# Results: ${this.title}`, '', `Recorded run. Machine: ${head}. Date: ${date}.`, ''];
    this.steps.forEach((s, i) => {
      parts.push(`## Step ${i + 1}`, '', '**Command**', '', '```sh', s.command, '```', '', '**Output**', '', '```text', s.output || '(no output)', '```', '', `**Note:** ${s.note}`, '');
    });
    return parts.join('\n');
  }

  write(path, machine) {
    writeFileSync(path, this.markdown(machine));
  }
}
